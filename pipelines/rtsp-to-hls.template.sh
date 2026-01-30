#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <rtsp_url> <output_dir> [segment_time]" >&2
  exit 1
fi

RTSP_URL="$1"
OUTPUT_DIR="$2"
SEGMENT_TIME="${3:-6}"

mkdir -p "${OUTPUT_DIR}"

gst-launch-1.0 \
  rtspsrc location="${RTSP_URL}" latency=0 ! \
  rtph264depay ! h264parse ! v4l2h264dec ! videoconvert ! \
  x264enc speed-preset=ultrafast tune=zerolatency ! mpegtsmux ! \
  hlssink2 playlist-location="${OUTPUT_DIR}/index.m3u8" \
  location="${OUTPUT_DIR}/segment-%05d.ts" \
  target-duration=${SEGMENT_TIME} playlist-length=5
