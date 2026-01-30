# ONVIF Integration

Halio Ops can connect to ONVIF-compliant cameras to fetch stream URIs, list media profiles, and bootstrap RTSP pipelines automatically.

## Environment Configuration
Define cameras in `.env` using the `ONVIF_CAMERAS` JSON array. Example for the camera at `192.168.1.121`:
```ini
ONVIF_CAMERAS=[
  {
    "id": "lobby-cam",
    "name": "Lobby Cam",
    "host": "192.168.1.121",
    "port": 80,
    "username": "admin",
    "password": "RBTeeyKM142!"
  }
]
```
> ⚠️ Replace credentials if they change. Avoid committing real passwords to version control.

Alternatively, set individual variables:
```ini
ONVIF_CAMERA_HOST=192.168.1.121
ONVIF_CAMERA_USER=admin
ONVIF_CAMERA_PASS=RBTeeyKM142!
ONVIF_CAMERA_ID=lobby-cam
ONVIF_CAMERA_NAME=Lobby Cam
```

## API Endpoints
- `GET /onvif/cameras` – list configured cameras (no secrets returned).
- `POST /onvif/cameras/:id/refresh` – re-initialize the ONVIF session.
- `GET /onvif/cameras/:id/profiles` – list media profiles (tokens + names).
- `POST /onvif/cameras/:id/stream-uri` – resolve the RTSP URI for a profile. Body (optional): `{ "profileToken": "Profile_1" }`.
- `POST /onvif/cameras/:id/start-pipeline` – start a Halio RTSP pipeline using the ONVIF stream. Body fields:
  - `profileToken` (optional) – choose profile, defaults to first.
  - `name` (optional) – pipeline name (`onvif-<id>` default).
  - `autoInfer`, `modelPath`, `segmentTime` – forwarded to pipeline service.

## Usage Example
```bash
# Fetch available profiles
curl http://localhost:3000/onvif/cameras/lobby-cam/profiles

# Resolve stream URI for default profile
curl -X POST http://localhost:3000/onvif/cameras/lobby-cam/stream-uri

# Start a pipeline named lobby-rtsp with auto inference
curl -X POST http://localhost:3000/onvif/cameras/lobby-cam/start-pipeline \
  -H 'Content-Type: application/json' \
  -d '{"name":"lobby-rtsp","autoInfer":true}'
```

ONVIF logs are forwarded to the WebSocket channel with `context: "onvif"`; dashboard support can surface status lights per camera in future iterations.
