FROM audio-dev:latest
COPY requirements.lock.txt /tmp/analysis-requirements.txt
RUN apt-get update && apt-get install -y --no-install-recommends python3-venv ffmpeg && rm -rf /var/lib/apt/lists/* \
 && python3 -m venv /opt/analysis \
 && /opt/analysis/bin/pip install --no-cache-dir -r /tmp/analysis-requirements.txt
ENV PATH=/opt/analysis/bin:$PATH NUMBA_CACHE_DIR=/tmp/numba OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1
WORKDIR /work
ENTRYPOINT ["python", "analysis/analyze.py"]
