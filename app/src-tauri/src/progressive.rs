//! Immutable 30-second PCM chunks, published from a loader to the audio producer.
use std::sync::{
    atomic::{
        AtomicUsize,
        Ordering::{Acquire, Release},
    },
    OnceLock,
};

pub struct Chunk {
    pub left: Vec<f32>,
    pub right: Vec<f32>,
}
pub struct Audio {
    chunks: Vec<OnceLock<Chunk>>,
    width: usize,
    total: AtomicUsize,
    loaded: AtomicUsize,
    pub bass: OnceLock<crate::smart::BassProfile>,
}
impl Audio {
    pub fn new(frames: usize) -> Self {
        Self {
            chunks: (0..480).map(|_| OnceLock::new()).collect(),
            width: crate::sample_rate::get() * 30,
            total: AtomicUsize::new(frames),
            loaded: AtomicUsize::new(0),
            bass: OnceLock::new(),
        }
    }
    pub fn total(&self) -> usize {
        self.total.load(Acquire)
    }
    pub fn loaded(&self) -> usize {
        self.loaded.load(Acquire)
    }
    pub fn publish(&self, chunk: Chunk) -> anyhow::Result<()> {
        let offset = self.loaded();
        anyhow::ensure!(
            chunk.left.len() == chunk.right.len()
                && !chunk.left.is_empty()
                && chunk.left.len() <= self.width
                && offset % self.width == 0,
            "Invalid progressive PCM chunk"
        );
        let count = chunk.left.len();
        let slot = self
            .chunks
            .get(offset / self.width)
            .ok_or_else(|| anyhow::anyhow!("Track exceeds four hours"))?;
        anyhow::ensure!(slot.set(chunk).is_ok(), "PCM chunk was already published");
        self.total
            .fetch_max(offset + count, std::sync::atomic::Ordering::AcqRel);
        self.loaded.store(offset + count, Release);
        Ok(())
    }
    pub fn finish(&self) {
        self.total.store(self.loaded(), Release);
    }
    pub fn slice(&self, channel: usize, offset: usize) -> &[f32] {
        self.chunks
            .get(offset / self.width)
            .and_then(OnceLock::get)
            .and_then(|chunk| {
                if channel == 0 {
                    chunk.left.get(offset % self.width..)
                } else {
                    chunk.right.get(offset % self.width..)
                }
            })
            .unwrap_or(&[])
    }
}

pub fn decode(
    mut input: impl std::io::Read,
    current: impl Fn() -> bool,
    mut publish: impl FnMut(Chunk) -> anyhow::Result<()>,
) -> anyhow::Result<String> {
    use sha2::{Digest, Sha256};
    let mut hash = Sha256::new();
    let width = crate::sample_rate::get() * 30;
    let mut left = Vec::with_capacity(width);
    let mut right = Vec::with_capacity(width);
    let mut bytes = [0_u8; 65536];
    let mut carry = 0;
    loop {
        anyhow::ensure!(current(), "Load superseded by a newer selection");
        let count = input.read(&mut bytes[carry..])?;
        if count == 0 {
            anyhow::ensure!(carry == 0, "Incomplete progressive PCM frame");
            if !left.is_empty() {
                publish(Chunk { left, right })?;
            }
            return Ok(format!("{:x}", hash.finalize()));
        }
        hash.update(&bytes[carry..carry + count]);
        let length = carry + count;
        let complete = length / 8 * 8;
        for frame in bytes[..complete].chunks_exact(8) {
            let a = f32::from_le_bytes(frame[..4].try_into()?);
            let b = f32::from_le_bytes(frame[4..].try_into()?);
            anyhow::ensure!(
                a.is_finite() && b.is_finite(),
                "Non-finite progressive PCM samples"
            );
            left.push(a);
            right.push(b);
            if left.len() == width {
                publish(Chunk {
                    left: std::mem::replace(&mut left, Vec::with_capacity(width)),
                    right: std::mem::replace(&mut right, Vec::with_capacity(width)),
                })?;
            }
        }
        carry = length - complete;
        bytes.copy_within(complete..length, 0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{decks::Voice, source::Source};
    use std::sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering::SeqCst},
        Arc,
    };
    fn audio() -> Arc<Source> {
        Arc::new(Source {
            progressive: Some(Audio::new(crate::sample_rate::get() * 60)),
            left: Vec::new(),
            right: Vec::new(),
            bass_profile: Default::default(),
        })
    }
    fn chunk(value: f32) -> Chunk {
        Chunk {
            left: vec![value; crate::sample_rate::get() * 30],
            right: vec![value; crate::sample_rate::get() * 30],
        }
    }
    #[test]
    fn progressive_voice_holds_at_unloaded_boundary_and_resumes_without_restarting() {
        let source = audio();
        let width = crate::sample_rate::get() * 30;
        source
            .progressive
            .as_ref()
            .unwrap()
            .publish(chunk(0.2))
            .unwrap();
        let mut voice = Voice::new(source.clone(), 1);
        voice.seek(width - 4);
        voice.playing = true;
        for _ in 0..4 {
            voice.next().unwrap();
        }
        assert_eq!(voice.position, width);
        for _ in 0..32 {
            assert_eq!(voice.next().unwrap(), [0.; 2]);
        }
        assert!(voice.playing);
        assert_eq!(voice.position, width);
        source
            .progressive
            .as_ref()
            .unwrap()
            .publish(chunk(-0.2))
            .unwrap();
        source.progressive.as_ref().unwrap().finish();
        voice.next().unwrap();
        assert_eq!(voice.position, width + 1);
        voice.seek(width + 100);
        voice.next().unwrap();
        assert_eq!(voice.position, width + 101);
        voice.loop_start = Some(width - 2);
        voice.loop_end = Some(width + 2);
        voice.seek(width - 2);
        for _ in 0..5 {
            voice.next().unwrap();
        }
        assert!(voice.position < width + 2);
    }
    #[test]
    fn progressive_pitch_and_tempo_match_a_fully_loaded_source() {
        let progressive = audio();
        let width = crate::sample_rate::get() * 30;
        let samples: Vec<f32> = (0..width * 2)
            .map(|i| (i as f32 * 0.03).sin() * 0.2)
            .collect();
        progressive
            .progressive
            .as_ref()
            .unwrap()
            .publish(Chunk {
                left: samples[..width].to_vec(),
                right: samples[..width].to_vec(),
            })
            .unwrap();
        let regular = Arc::new(Source {
            progressive: None,
            left: samples.clone(),
            right: samples,
            bass_profile: Default::default(),
        });
        let mut a = Voice::new(progressive, 1);
        let mut b = Voice::new(regular, 1);
        let grid = crate::timing::Grid {
            bpm: 140.,
            downbeat_seconds: 0.,
            reviewed: false,
        };
        for voice in [&mut a, &mut b] {
            voice.apply_grid(grid);
            voice.tempo(125.).unwrap();
            voice.playing = true;
        }
        for _ in 0..4096 {
            assert_eq!(a.next().unwrap(), b.next().unwrap());
        }
    }
    #[test]
    fn progressive_decoder_publishes_first_chunk_before_eof_and_obeys_cancellation() {
        struct Input {
            count: Arc<AtomicUsize>,
            total: usize,
        }
        impl std::io::Read for Input {
            fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
                let n = buffer.len().min(self.total - self.count.load(SeqCst));
                buffer[..n].fill(0);
                self.count.fetch_add(n, SeqCst);
                Ok(n)
            }
        }
        let count = Arc::new(AtomicUsize::new(0));
        let total = crate::sample_rate::get() * 60 * 8;
        let active = AtomicBool::new(true);
        let mut chunks = 0;
        let outcome = decode(
            Input {
                count: count.clone(),
                total,
            },
            || active.load(SeqCst),
            |chunk| {
                chunks += 1;
                assert_eq!(chunk.left.len(), crate::sample_rate::get() * 30);
                assert!(count.load(SeqCst) < total);
                active.store(false, SeqCst);
                Ok(())
            },
        );
        assert!(outcome.is_err());
        assert_eq!(chunks, 1);
        assert!(decode(&[0_u8; 7][..], || true, |_| Ok(())).is_err());
    }
    #[test]
    fn progressive_pcm_hash_and_samples_survive_fragmented_reads() {
        use sha2::{Digest, Sha256};
        struct Fragmented(std::io::Cursor<Vec<u8>>);
        impl std::io::Read for Fragmented {
            fn read(&mut self, bytes: &mut [u8]) -> std::io::Result<usize> {
                let length = bytes.len().min(3);
                std::io::Read::read(&mut self.0, &mut bytes[..length])
            }
        }
        let bytes: Vec<u8> = [0.2_f32, -0.3, 0.4, -0.5]
            .into_iter()
            .flat_map(f32::to_le_bytes)
            .collect();
        let digest = decode(
            Fragmented(std::io::Cursor::new(bytes.clone())),
            || true,
            |chunk| {
                assert_eq!(chunk.left, [0.2, 0.4]);
                assert_eq!(chunk.right, [-0.3, -0.5]);
                Ok(())
            },
        )
        .unwrap();
        assert_eq!(digest, format!("{:x}", Sha256::digest(bytes)));
    }
}
