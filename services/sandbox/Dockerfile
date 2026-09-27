# ── Stage 1: grab Node 22 binaries ──────────────────────────────────────────
FROM node:22-bookworm-slim AS node_base

# ── Stage 2: final image ─────────────────────────────────────────────────────
FROM python:3.12-slim

# Copy the entire Node runtime from the node image.
# npm is a shell script that requires node_modules/npm/lib/cli.js next to it,
# so we must copy /usr/local as a unit rather than individual files.
COPY --from=node_base /usr/local /usr/local

# Install GNU time (for per-run peak-memory measurement, SPEC trap 4).
RUN apt-get update && apt-get install -y --no-install-recommends time \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install Jest locally inside js_runner/ (same copy used at runtime).
COPY js_runner/package.json js_runner/package-lock.json* ./js_runner/
RUN cd js_runner && npm ci

# Copy the rest of the application.
COPY . .

# Create a non-root user with a high UID to avoid matching host UIDs
# (SPEC trap 6 — ulimit -u counts by user, Docker --pids-limit is safer).
RUN useradd --uid 10001 --no-create-home --shell /bin/false sandbox
USER sandbox

EXPOSE 8002

CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8002"]
