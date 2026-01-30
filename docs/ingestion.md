# RTMP Ingestion

Halio Ops now supports ingesting multiple RTMP sources and converting them to HLS segments for Halio inference.

## Requirements
- `ffmpeg` must be installed (covered by `scripts/bootstrap-system.sh`).
- Sources should publish RTMP streams compatible with H.264 video. Audio is transcoded to AAC automatically.

## Launch an Ingest
```bash
curl -X POST http://localhost:3000/ingest/rtmp \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "stage-feed",
    "rtmpUrl": "rtmp://encoder/live/stage",
    "autoInfer": true,
    "segmentTime": 4
  }'
```
Outputs land in `RTMP_STORAGE` (default `pipelines/rtmp/<name>`). The API response includes the manifest path for downstream consumers.

## Control Inference
```bash
# Enable inference watcher with explicit model
curl -X POST http://localhost:3000/ingest/rtmp/stage-feed/inference/start \
  -H 'Content-Type: application/json' \
  -d '{"modelPath": "/opt/halio/models/detect.hbm"}'

# Disable inference
curl -X DELETE http://localhost:3000/ingest/rtmp/stage-feed/inference
```
Inference results appear on the WebSocket feed (`type: "inference-result"`). Each payload includes `stream` to distinguish from RTSP pipelines.

## Stop an Ingest
```bash
curl -X DELETE http://localhost:3000/ingest/rtmp/stage-feed
```
The FFmpeg process receives a cancellation signal and resources are cleaned up automatically.

## Monitoring
- `GET /ingest/rtmp` – list current ingests.
- WebSocket `pipeline-log` events carry FFmpeg logs tagged by `stream`.
- Dashboard integration is planned; for now inspect logs or use the API.
