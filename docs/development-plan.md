# Development Plan

## Phase 1 – Foundations (current)
- [x] Create project scaffolding under `halio-ops`.
- [x] Document system bootstrap steps.
- [x] Provide baseline RTSP→HLS pipeline management APIs.
- [x] Integrate Halio AI SDK bindings and inference triggers.
- [x] Build shadcn-inspired Tailwind dashboard targeting port 7002.
- [x] Add FFmpeg-based RTMP ingestion with Halio inference controls.
- [x] Integrate ONVIF camera helpers for automated pipeline bootstrapping.
- [ ] Establish workflow builder hooks (port 7003) for pipeline automation.

## Phase 2 – AI Integration
- Implement `halctl` wrappers for model deployment and inference control.
- Attach AI inference results to WebSocket event stream.
- Add persistence for pipeline metadata (SQLite or LiteFS).

## Phase 3 – Operations & Observability
- Package services with systemd units and health checks.
- Add Prometheus metrics exporter and Grafana dashboards.
- Harden security (TLS termination, authn/z, secrets management).

## Phase 4 – UX & Automation
- Deliver dark-mode dashboard UI with live video previews.
- Integrate workflow automation builder with pipeline REST API.
- Provide CLI utilities for provisioning new cameras and AI jobs.
