# Halio Ops

Operations stack for running the Halio AI HAT on Raspberry Pi 5, processing RTSP/RTMP video streams into AI-friendly formats and exposing control interfaces.

## Stack Overview
- **System services**: Nginx (reverse proxy, static content), Node.js API for pipeline control, optional websocket event stream.
- **Media processing**: GStreamer pipelines for ingesting RTSP, FFmpeg-based RTMP ingestion, both targeting HLS outputs consumable by the Halio unit.
- **AI integration**: `halctl`-driven inference watchers that process fresh segments and publish structured results via WebSocket.
- **ONVIF**: Camera discovery helpers to fetch stream URIs and bootstrap pipelines from ONVIF-compliant devices.
- **Dashboard**: Dark shadcn-inspired Tailwind dashboard (static HTML/JS) under `ui/dashboard` for monitoring pipelines, ingests, live previews, and inference events.

## Quick Start
1. Install dependencies (first run only):
   ```bash
   sudo ./scripts/bootstrap-system.sh
   ```
2. Create a working env file:
   ```bash
   cp .env.example .env
   # edit the values as needed (set HALIO_MODEL_PATH, RTSP_INPUT_URL, ONVIF_CAMERAS, etc.)
   ```
3. Install Node packages:
   ```bash
   npm install
   ```
4. Run the API server:
   ```bash
   npm run dev
   ```
5. Build dashboard assets and serve locally:
   ```bash
   npm run build:ui
   cd ui/dashboard
   python3 -m http.server 7002  # static dashboard (dark mode)
   ```

The API listens on `http://localhost:3000` by default. WebSocket events are available at `ws://localhost:3000/events`. Set `localStorage.halio-api-base` in the browser console if the API lives on another host.

### Media Preview & Static Assets
- HLS outputs are exposed under `/media/pipelines/<name>/index.m3u8` (RTSP pipelines) and `/media/rtmp/<name>/index.m3u8` (RTMP ingests).
- The dashboard auto-populates these sources for inline preview using HLS.js when needed.

### WebSocket Events
Messages are JSON with a `type` key.
- `pipeline-log` – log lines from RTSP pipelines, RTMP ingests, or ONVIF helpers (see `context` field).
- `inference-result` – emitted after each successfully processed segment.
  ```json
  {
    "type": "inference-result",
    "context": "rtmp",
    "pipeline": "stage-feed",
    "segment": "segment-00042.ts",
    "modelPath": "/opt/halio/models/detect.hbm",
    "data": { "objects": [] },
    "timestamp": "2025-11-12T08:30:21.123Z"
  }
  ```

## API Surface
- `GET /health` – service heartbeat, confirms Halio availability and device path.
- `GET /config` – resolved runtime configuration.
- `GET /halio/status` – returns `halctl` availability, default model, and auto-infer flag.
- `GET /halio/models` – lists models known to `halctl` (requires SDK).
- `GET /pipelines` – list active RTSP pipelines (manifest URLs included).
- `POST /pipelines/rtsp-to-hls` – start RTSP pipeline.
- `POST /pipelines/:name/inference/start` – enable Halio inference for an RTSP pipeline.
- `DELETE /pipelines/:name/inference` – disable inference watcher for a pipeline.
- `DELETE /pipelines/:name` – stop a running pipeline.
- `GET /ingest/rtmp` – list active RTMP ingests.
- `POST /ingest/rtmp` – launch RTMP → HLS ingest.
- `POST /ingest/rtmp/:name/inference/start` – enable inference watcher for an RTMP ingest.
- `DELETE /ingest/rtmp/:name/inference` – disable inference watcher for an ingest.
- `DELETE /ingest/rtmp/:name` – stop an RTMP ingest.
- `GET /onvif/cameras` – list configured ONVIF cameras.
- `POST /onvif/cameras/:id/refresh` – reinitialize ONVIF session.
- `GET /onvif/cameras/:id/profiles` – fetch media profile tokens.
- `POST /onvif/cameras/:id/stream-uri` – resolve RTSP URI for a profile.
- `POST /onvif/cameras/:id/start-pipeline` – launch an RTSP pipeline using the ONVIF stream.

## Environment
Key variables defined in `.env.example`:
- `HALIO_MODEL_PATH` – default model used for inference watchers.
- `AUTO_INFER` – enable inference automatically when pipelines/ingests start (`true` / `false`).
- `HALIO_DEVICE_PATH`, `RTSP_INPUT_URL`, `PIPELINE_STORAGE`, `RTMP_STORAGE`, `PORT`.
- `ONVIF_CAMERAS` – JSON array describing ONVIF-capable cameras (host, credentials, name).

## Nginx Reverse Proxy
A sample site config is provided in `configs/nginx/halio-ops.conf`. Symlink it into `/etc/nginx/sites-enabled` and reload Nginx:
```bash
sudo ln -sf $(pwd)/configs/nginx/halio-ops.conf /etc/nginx/sites-enabled/halio-ops
sudo systemctl reload nginx
```

## Testing
Jest powers the test suite. Always run tests before claiming production readiness.
```bash
npm test
```

## Next Steps
- Surface ONVIF status in the dashboard and expose PTZ presets.
- Add workflow builder integrations (port 7003) to automate pipeline + inference orchestration.
- Package services with systemd units and metrics for production ops.

See `docs/development-plan.md` for roadmap details.
