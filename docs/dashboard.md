# Dashboard Guide

## Overview
The dashboard under `ui/dashboard` is a static dark-mode interface inspired by shadcn styling. It surfaces:
- Halio device/API health badges
- Active RTSP pipelines and RTMP ingests with quick actions and type-specific badges
- Live preview card powered by HLS.js for inline monitoring of HLS manifests
- Live `inference-result` feed streamed over WebSocket (RTSP = slate badge, RTMP = purple badge)
- Modal workflows to spin up new RTSP pipelines or RTMP ingests with optional automatic inference

## Build & Serve
```bash
npm run build:ui
cd ui/dashboard
python3 -m http.server 7002
```

The dashboard auto-targets the API on the same host at port `3000`. To override (for example when tunneling), set the base URL in the browser console:
```js
localStorage.setItem('halio-api-base', 'http://halio-node.local:3000');
window.location.reload();
```

## Development Workflow
- `npm run watch:ui` keeps Tailwind recompiling while editing `ui/dashboard/styles/tailwind.css`.
- Static assets (fonts/icons) live under `ui/dashboard/assets`.
- JavaScript entry point: `ui/dashboard/js/app.js`.

## Implementation Notes
- Uses native `<dialog>` for launch modals; a11y-friendly with `method="dialog"` submit/cancel.
- Preview dropdown lists RTSP pipelines and RTMP ingests that expose `manifestUrl` (`/media/pipelines/<name>/index.m3u8`, `/media/rtmp/<name>/index.m3u8`).
- WebSocket auto-reconnects with backoff; inference results limited to 50 latest entries.
- Buttons hit REST endpoints documented in README; update selectors if the API surface changes.
- Extend styling by augmenting `@layer components` within Tailwind source.
