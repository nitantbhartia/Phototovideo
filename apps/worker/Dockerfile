FROM python:3.12-slim

# Install system dependencies including ffmpeg with H.265/HEVC support
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libx265-dev \
    libpq-dev \
    gcc \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Create assets directory for background music
# Drop real MP3s into assets/music/ to override synthetic generation
# Naming: ambient.mp3, upbeat.mp3, cinematic.mp3, lofi.mp3, elegant.mp3
RUN mkdir -p assets/music

# Non-root user for security
RUN useradd -m -u 1001 worker && chown -R worker:worker /app
USER worker

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget -qO- http://localhost:${PORT:-8000}/health || exit 1

EXPOSE 8000

CMD ["python", "worker.py"]
