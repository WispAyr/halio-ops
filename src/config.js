const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

function parseOnvifCameras() {
  const cameras = [];
  if (process.env.ONVIF_CAMERAS) {
    try {
      const parsed = JSON.parse(process.env.ONVIF_CAMERAS);
      if (Array.isArray(parsed)) {
        parsed.forEach((cam, index) => {
          if (cam && cam.host) {
            cameras.push({
              id: cam.id || `camera-${index + 1}`,
              name: cam.name || cam.id || `Camera ${index + 1}`,
              host: cam.host,
              port: cam.port || 80,
              username: cam.username || cam.user || '',
              password: cam.password || cam.pass || '',
              xaddr: cam.xaddr,
            });
          }
        });
      }
    } catch (err) {
      console.warn('[config] Failed to parse ONVIF_CAMERAS JSON:', err.message);
    }
  }

  if (!cameras.length && process.env.ONVIF_CAMERA_HOST) {
    cameras.push({
      id: process.env.ONVIF_CAMERA_ID || 'camera-1',
      name: process.env.ONVIF_CAMERA_NAME || process.env.ONVIF_CAMERA_ID || 'Camera 1',
      host: process.env.ONVIF_CAMERA_HOST,
      port: Number(process.env.ONVIF_CAMERA_PORT || 80),
      username: process.env.ONVIF_CAMERA_USER || process.env.ONVIF_CAMERA_USERNAME || '',
      password: process.env.ONVIF_CAMERA_PASS || process.env.ONVIF_CAMERA_PASSWORD || '',
      xaddr: process.env.ONVIF_CAMERA_XADDR,
    });
  }

  return cameras;
}

const config = {
  port: Number(process.env.PORT || 3000),
  halioDevicePath: process.env.HALIO_DEVICE_PATH || '/dev/hailo0',
  halioModelPath: process.env.HALIO_MODEL_PATH || '/usr/share/hailo-models/yolov8s_h8l.hef',
  rtspInputUrl: process.env.RTSP_INPUT_URL || '',
  pipelineStorage: process.env.PIPELINE_STORAGE || path.resolve(process.cwd(), 'pipelines/output'),
  rtmpStorage: process.env.RTMP_STORAGE || path.resolve(process.cwd(), 'pipelines/rtmp'),
  autoInfer: process.env.AUTO_INFER === 'true',
  onvifCameras: parseOnvifCameras(),
};

[config.pipelineStorage, config.rtmpStorage].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

module.exports = config;
