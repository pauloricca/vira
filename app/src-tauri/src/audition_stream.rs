//! Bounded PCM streaming. HTTP, decoding and waiting stay off the audio producer.
use anyhow::{ensure, Result};
use std::{
    io::Read,
    sync::{
        atomic::{
            AtomicBool, AtomicU64, AtomicUsize,
            Ordering::{Acquire, Release},
        },
        mpsc, Arc, Mutex,
    },
    time::Duration,
};

struct Sample {
    epoch: u64,
    audio: [f32; 2],
}
pub struct Status {
    cancelled: AtomicBool,
    epoch: AtomicU64,
    seek: AtomicUsize,
    eof: AtomicU64,
    error: Mutex<Option<String>>,
}
impl Status {
    pub fn error(&self) -> Option<String> {
        self.error.lock().unwrap().clone()
    }
}
pub struct Stream {
    pub frames: usize,
    pub status: Arc<Status>,
    samples: rtrb::Consumer<Sample>,
}
impl Drop for Stream {
    fn drop(&mut self) {
        self.status.cancelled.store(true, Release);
    }
}
impl Stream {
    #[cfg(test)]
    pub(crate) fn fixture(audio: &[[f32; 2]]) -> Self {
        let (mut producer, samples) = rtrb::RingBuffer::new(audio.len().max(1));
        for sample in audio {
            let _ = producer.push(Sample {
                epoch: 0,
                audio: *sample,
            });
        }
        Self {
            frames: audio.len(),
            samples,
            status: Arc::new(Status {
                cancelled: AtomicBool::new(false),
                epoch: AtomicU64::new(0),
                seek: AtomicUsize::new(0),
                eof: AtomicU64::new(0),
                error: Mutex::new(None),
            }),
        }
    }
    pub fn open(track: String, current: impl Fn() -> bool + Send + 'static) -> Result<Self> {
        Self::open_at(track, 0., current)
    }
    pub fn open_at(
        track: String,
        seconds: f64,
        current: impl Fn() -> bool + Send + 'static,
    ) -> Result<Self> {
        ensure!(
            crate::valid_id(&track),
            "Audition requires a library track ID"
        );
        Self::open_url_at(
            track,
            current,
            format!("{}/v1/audition/stream", crate::SERVICE_URL),
            seconds,
        )
    }
    fn open_url(
        track: String,
        current: impl Fn() -> bool + Send + 'static,
        url: String,
    ) -> Result<Self> {
        Self::open_url_at(track, current, url, 0.)
    }
    fn open_url_at(
        track: String,
        current: impl Fn() -> bool + Send + 'static,
        url: String,
        seconds: f64,
    ) -> Result<Self> {
        let (mut producer, consumer) = rtrb::RingBuffer::new(crate::sample_rate::get() / 2);
        let status = Arc::new(Status {
            cancelled: AtomicBool::new(false),
            epoch: AtomicU64::new(0),
            seek: AtomicUsize::new((seconds * crate::sample_rate::get() as f64).round() as usize),
            eof: AtomicU64::new(u64::MAX),
            error: Mutex::new(None),
        });
        let worker = status.clone();
        let (ready, receive) = mpsc::sync_channel(1);
        std::thread::Builder::new()
            .name("audition-stream".into())
            .spawn(move || {
                let mut ready = Some(ready);
                let active = || !worker.cancelled.load(Acquire) && current();
                let outcome = (|| -> Result<()> {
                    // The normal service client has a whole-response timeout. An
                    // audition may remain open for hours or while paused.
                    let client = reqwest::blocking::Client::builder()
                        .no_proxy()
                        .redirect(reqwest::redirect::Policy::none())
                        .connect_timeout(Duration::from_secs(2))
                        .timeout(None)
                        .build()?;
                    while active() {
                        let epoch = worker.epoch.load(Acquire);
                        let start = worker.seek.load(Acquire);
                        let body = serde_json::json!({
                            "track_id": track, "sample_rate": crate::sample_rate::get(),
                            "position_seconds": start as f64 / crate::sample_rate::get() as f64
                        });
                        let mut response =
                            client.post(&url).json(&body).send()?.error_for_status()?;
                        let duration: f64 = response
                            .headers()
                            .get("X-Vira-Duration-Seconds")
                            .ok_or_else(|| anyhow::anyhow!("Missing audition duration"))?
                            .to_str()?
                            .parse()?;
                        ensure!(
                            duration.is_finite() && duration > 0. && duration <= 4. * 60. * 60.,
                            "Invalid audition duration"
                        );
                        let mut buffered = 0;
                        let mut bytes = [0_u8; 16384];
                        let mut carry = 0;
                        while active() && worker.epoch.load(Acquire) == epoch {
                            let count = response.read(&mut bytes[carry..])?;
                            if count == 0 {
                                ensure!(carry == 0, "Incomplete audition PCM frame");
                                worker.eof.store(epoch, Release);
                                if let Some(ready) = ready.take() {
                                    let _ = ready.send(Ok(duration));
                                }
                                break;
                            }
                            let length = carry + count;
                            let complete = length / 8 * 8;
                            for frame in bytes[..complete].chunks_exact(8) {
                                if worker.cancelled.load(Acquire)
                                    || worker.epoch.load(Acquire) != epoch
                                {
                                    break;
                                }
                                let audio = [
                                    f32::from_le_bytes(frame[..4].try_into()?),
                                    f32::from_le_bytes(frame[4..].try_into()?),
                                ];
                                ensure!(
                                    audio.iter().all(|v| v.is_finite()),
                                    "Non-finite audition samples"
                                );
                                let mut sample = Sample { epoch, audio };
                                loop {
                                    if worker.cancelled.load(Acquire)
                                        || worker.epoch.load(Acquire) != epoch
                                    {
                                        break;
                                    }
                                    match producer.push(sample) {
                                        Ok(()) => break,
                                        Err(rtrb::PushError::Full(value)) => {
                                            if !current() {
                                                break;
                                            }
                                            sample = value;
                                            std::thread::sleep(Duration::from_millis(2));
                                        }
                                    }
                                }
                                buffered += 1;
                                if buffered >= 2048 {
                                    if let Some(ready) = ready.take() {
                                        let _ = ready.send(Ok(duration));
                                    }
                                }
                            }
                            carry = length - complete;
                            bytes.copy_within(complete..length, 0);
                        }
                        drop(response); // Closing an old seek/selection also reaps its FFmpeg process.
                        while active() && worker.epoch.load(Acquire) == epoch {
                            std::thread::sleep(Duration::from_millis(5));
                        }
                    }
                    Ok(())
                })();
                if let Err(error) = outcome {
                    if active() {
                        *worker.error.lock().unwrap() = Some(format!("Audition stream: {error:#}"));
                        worker.eof.store(worker.epoch.load(Acquire), Release);
                    }
                    if let Some(ready) = ready.take() {
                        let _ = ready.send(Err(error.to_string()));
                    }
                }
            })?;
        let mut stream = Self {
            frames: 0,
            status,
            samples: consumer,
        };
        let duration = receive
            .recv_timeout(Duration::from_secs(15))
            .map_err(|error| match error {
                mpsc::RecvTimeoutError::Timeout => {
                    anyhow::anyhow!("Audition stream did not start within 15 seconds")
                }
                mpsc::RecvTimeoutError::Disconnected => anyhow::anyhow!("Audition cancelled"),
            })?
            .map_err(anyhow::Error::msg)?;
        stream.frames = (duration * crate::sample_rate::get() as f64).round() as usize;
        Ok(stream)
    }
    pub fn seek(&mut self, frame: usize) {
        self.status.seek.store(frame.min(self.frames), Release);
        self.status
            .epoch
            .fetch_add(1, std::sync::atomic::Ordering::AcqRel);
    }
    /// No allocation, lock, network read or waiting on the audio producer.
    pub fn sample(&mut self) -> Option<[f32; 2]> {
        let epoch = self.status.epoch.load(Acquire);
        for _ in 0..64 {
            match self.samples.pop() {
                Ok(sample) if sample.epoch == epoch => return Some(sample.audio),
                Ok(_) => continue,
                Err(_) => break,
            }
        }
        None
    }
    pub fn ended(&self) -> bool {
        self.samples.is_empty() && self.status.eof.load(Acquire) == self.status.epoch.load(Acquire)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{BufRead, BufReader, Write},
        net::{TcpListener, TcpStream},
        time::Instant,
    };

    fn request(socket: &TcpStream) -> serde_json::Value {
        let mut reader = BufReader::new(socket.try_clone().unwrap());
        let mut length = 0;
        loop {
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            if line == "\r\n" {
                break;
            }
            if let Some(value) = line.to_lowercase().strip_prefix("content-length:") {
                length = value.trim().parse().unwrap();
            }
        }
        let mut bytes = vec![0; length];
        reader.read_exact(&mut bytes).unwrap();
        serde_json::from_slice(&bytes).unwrap()
    }
    fn wait_sample(stream: &mut Stream) -> [f32; 2] {
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            if let Some(sample) = stream.sample() {
                return sample;
            }
            assert!(
                Instant::now() < deadline,
                "stream did not provide samples: {:?}",
                stream.status.error()
            );
            std::thread::sleep(Duration::from_millis(1));
        }
    }
    #[test]
    fn audition_stream_starts_before_eof_and_seek_discards_buffered_audio() {
        let server = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/stream", server.local_addr().unwrap());
        let (release, finish) = mpsc::channel();
        let worker = std::thread::spawn(move || {
            for (seek, value) in [(0., 0.25_f32), (1., 0.75_f32)] {
                let (mut socket, _) = server.accept().unwrap();
                socket
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                assert_eq!(request(&socket)["position_seconds"], seek);
                write!(socket, "HTTP/1.1 200 OK\r\nX-Vira-Duration-Seconds: 4\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", 4096 * 8).unwrap();
                let bytes: Vec<u8> = (0..4096 * 2).flat_map(|_| value.to_le_bytes()).collect();
                socket.write_all(&bytes[..2048 * 8]).unwrap();
                if seek == 0. {
                    finish.recv_timeout(Duration::from_secs(5)).unwrap();
                }
                let _ = socket.write_all(&bytes[2048 * 8..]);
            }
        });
        let mut stream = Stream::open_url("a".repeat(64), || true, url).unwrap();
        assert_eq!(wait_sample(&mut stream), [0.25; 2]);
        assert!(!stream.ended());
        // The server has not sent the rest of the first response yet.
        stream.seek(crate::sample_rate::get());
        release.send(()).unwrap();
        assert_eq!(wait_sample(&mut stream), [0.75; 2]);
        let status = stream.status.clone();
        drop(stream);
        assert!(status.cancelled.load(Acquire));
        worker.join().unwrap();
    }
    #[test]
    fn audition_stream_reports_truncated_response_instead_of_hanging() {
        let server = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/stream", server.local_addr().unwrap());
        let worker = std::thread::spawn(move || {
            let (mut socket, _) = server.accept().unwrap();
            request(&socket);
            write!(socket, "HTTP/1.1 200 OK\r\nX-Vira-Duration-Seconds: 4\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", 4096 * 8).unwrap();
            socket.write_all(&vec![0; 2048 * 8]).unwrap();
        });
        let mut stream = Stream::open_url("a".repeat(64), || true, url).unwrap();
        let deadline = Instant::now() + Duration::from_secs(3);
        while !stream.ended() {
            stream.sample();
            assert!(Instant::now() < deadline);
            std::thread::yield_now();
        }
        assert!(stream.status.error().is_some());
        worker.join().unwrap();
    }
    #[test]
    fn audition_stream_opens_directly_at_one_minute() {
        let server = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/stream", server.local_addr().unwrap());
        let worker = std::thread::spawn(move || {
            let (mut socket, _) = server.accept().unwrap();
            assert_eq!(request(&socket)["position_seconds"], 60.);
            write!(socket, "HTTP/1.1 200 OK\r\nX-Vira-Duration-Seconds: 120\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", 2048 * 8).unwrap();
            socket.write_all(&vec![0; 2048 * 8]).unwrap();
        });
        let mut stream = Stream::open_url_at("a".repeat(64), || true, url, 60.).unwrap();
        assert_eq!(wait_sample(&mut stream), [0.; 2]);
        worker.join().unwrap();
    }
}
