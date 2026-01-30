# Pipeline Reference

## RTSP → HLS
- Uses hardware decode via `v4l2h264dec` when available.
- Re-encodes with `x264enc` for HLS compatibility (tune for low latency).
- Output stored under `pipelines/output/<pipeline-name>` with `index.m3u8` + MPEG-TS segments.

### Start via API
```bash
curl -X POST http://localhost:3000/pipelines/rtsp-to-hls \
  -H 'Content-Type: application/json' \
  -d '{"name": "cam01", "rtspUrl": "rtsp://camera/stream", "autoInfer": true}'
```

## RTMP → HLS
- FFmpeg handles ingestion (`ffmpeg -i rtmp://... -f hls ...`).
- Maintains rolling playlist (`hls_list_size=5`) with deletions to limit storage.
- Supports batch creation via `sources` array.

### Start via API (single)
```bash
curl -X POST http://localhost:3000/pipelines/rtmp-to-hls \
  -H 'Content-Type: application/json' \
  -d '{"name": "rtmp-stage", "rtmpUrl": "rtmp://encoder/live/stage", "autoInfer": true}'
```

### Start via API (batch)
```bash
curl -X POST http://localhost:3000/pipelines/rtmp-to-hls \
  -H 'Content-Type: application/json' \
  -d '{"sources": [
        {"name": "rtmp-a", "rtmpUrl": "rtmp://server/live/a"},
        {"name": "rtmp-b", "rtmpUrl": "rtmp://server/live/b", "autoInfer": false}
      ]}'
```

## Inference Control
```bash
# Start inference watcher with custom model
curl -X POST http://localhost:3000/pipelines/cam01/inference/start \
  -H 'Content-Type: application/json' \
  -d '{"modelPath": "/opt/halio/models/detect.hbm"}'

# Stop inference watcher
curl -X DELETE http://localhost:3000/pipelines/cam01/inference
```

Once enabled, new MPEG-TS segments trigger `halctl infer` runs. WebSocket clients receive:
- `pipeline-log` entries for processing status.
- `inference-result` payloads containing parsed JSON output and metadata.

## Latency Considerations
- Reduce `segmentTime` for lower latency but more frequent segment churn.
- Use `hlssink2 playlist-length=5` or smaller `hls_list_size` for RTMP.
- Consider WebRTC or LL-HLS for sub-second requirements (future work).

## AI Consumption
- Halio inference can consume TS segments directly; extend `halioService` to tee decoded frames or publish embeddings.
- WebSocket `inference-result` payloads can feed dashboards, alerting pipelines, or downstream analytics.
