const path = require('path');
const express = require('express');
const cors = require('cors');
const pipelineService = require('./services/pipelineService');
const rtmpIngestService = require('./services/rtmpIngestService');
const onvifService = require('./services/onvifService');
const halioService = require('./services/halioService');
const config = require('./config');
const statusService = require("./services/statusService");
const analyzeRoutes = require('./routes/analyze');

const app = express();
app.use(cors());
app.use(express.json());

// Serve HLS manifests and segments with proper headers and CORS
app.use('/media/pipelines', express.static(path.resolve(config.pipelineStorage), {
  setHeaders: (res, filePath) => {
    // CORS headers for all media files
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    
    if (filePath.endsWith('.m3u8')) {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    } else if (filePath.endsWith('.ts')) {
      res.setHeader('Content-Type', 'video/mp2t');
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));
app.use('/media/rtmp', express.static(path.resolve(config.rtmpStorage), {
  setHeaders: (res, filePath) => {
    // CORS headers for all media files
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    
    if (filePath.endsWith('.m3u8')) {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    } else if (filePath.endsWith('.ts')) {
      res.setHeader('Content-Type', 'video/mp2t');
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

// Serve dashboard UI
const dashboardPath = path.resolve(__dirname, '../ui/dashboard');
app.use(express.static(dashboardPath));
app.get('/', (_req, res) => {
  res.sendFile(path.join(dashboardPath, 'index.html'));
});

// Serve favicon to prevent 404 errors
app.get('/favicon.ico', (_req, res) => {
  res.status(204).end();
});

app.get('/health', async (_req, res) => {
  const halioAvailable = await halioService.isAvailable();
  res.json({ status: 'ok', halioDevice: config.halioDevicePath, halioAvailable });
});


// Developer status endpoint - real-time activity
app.get("/status", async (_req, res) => {
  const halioAvailable = await halioService.isAvailable();
  const pipelines = pipelineService.listPipelines();
  const ingests = rtmpIngestService.list();
  const status = statusService.getStatus();
  
  res.json({
    ...status,
    hailo: {
      available: halioAvailable,
      device: config.halioDevicePath,
      model: config.halioModelPath,
    },
    pipelines: pipelines.length,
    activePipelines: pipelines.filter(p => p.running).length,
    ingests: ingests.length,
  });
});
app.get('/config', (_req, res) => {
  res.json(config);
});

app.get('/halio/status', async (_req, res) => {
  const available = await halioService.isAvailable();
  res.json({
    available,
    modelPath: config.halioModelPath,
    autoInferDefault: config.autoInfer,
  });
});

app.get('/halio/models', async (_req, res) => {
  try {
    const models = await halioService.listModels();
    res.json({ models });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get('/halio/models/available', (_req, res) => {
  try {
    const fs = require('fs');
    const modelsDir = '/usr/share/hailo-models';
    const models = [];
    
    if (fs.existsSync(modelsDir)) {
      const files = fs.readdirSync(modelsDir);
      files.forEach(file => {
        if (file.endsWith('.hef')) {
          models.push({
            path: `${modelsDir}/${file}`,
            name: file,
            displayName: file.replace('.hef', '').replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
          });
        }
      });
    }
    
    res.json({ models: models.sort((a, b) => a.name.localeCompare(b.name)) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/pipelines', (_req, res) => {
  res.json({ pipelines: pipelineService.listPipelines() });
});

app.post('/pipelines/rtsp-to-hls', async (req, res) => {
  try {
    const payload = req.body || {};
    const info = await pipelineService.startRtspToHls(payload);
    res.status(201).json({ pipeline: info });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/pipelines/:name/inference/start', (req, res) => {
  try {
    const options = req.body || {};
    const pipeline = pipelineService.enableAutoInfer(req.params.name, options);
    res.json({ pipeline });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/pipelines/:name/inference', (req, res) => {
  try {
    const pipeline = pipelineService.disableAutoInfer(req.params.name);
    res.json({ pipeline });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/pipelines/:name', (req, res) => {
  try {
    const info = pipelineService.stopPipeline(req.params.name);
    res.json({ pipeline: info });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

app.get('/ingest/rtmp', (_req, res) => {
  res.json({ ingests: rtmpIngestService.list() });
});

app.post('/ingest/rtmp', async (req, res) => {
  try {
    const payload = req.body || {};
    const ingest = await rtmpIngestService.start(payload);
    res.status(201).json({ ingest });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/ingest/rtmp/:name/inference/start', (req, res) => {
  try {
    const ingest = rtmpIngestService.enableAutoInfer(req.params.name, req.body || {});
    res.json({ ingest });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/ingest/rtmp/:name/inference', (req, res) => {
  try {
    const ingest = rtmpIngestService.disableAutoInfer(req.params.name);
    res.json({ ingest });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/ingest/rtmp/:name', (req, res) => {
  try {
    const ingest = rtmpIngestService.stop(req.params.name);
    res.json({ ingest });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

app.get('/onvif/cameras', (_req, res) => {
  res.json({ cameras: onvifService.listCameras() });
});

app.post('/onvif/cameras/:id/refresh', async (req, res) => {
  try {
    await onvifService.refreshCamera(req.params.id);
    res.json({ status: 'refreshed' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/onvif/cameras/:id/profiles', async (req, res) => {
  try {
    const profiles = await onvifService.getProfiles(req.params.id);
    res.json({ profiles });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/onvif/cameras/:id/stream-uri', async (req, res) => {
  try {
    const { profileToken } = req.body || {};
    const stream = await onvifService.getStreamUri(req.params.id, profileToken);
    res.json({ stream });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/onvif/cameras/:id/start-pipeline', async (req, res) => {
  try {
    const { profileToken, name, autoInfer, modelPath, segmentTime } = req.body || {};
    const stream = await onvifService.getStreamUri(req.params.id, profileToken);
    const pipeline = await pipelineService.startRtspToHls({
      name: name || `onvif-${req.params.id}`,
      rtspUrl: stream.uri,
      autoInfer,
      modelPath,
      segmentTime,
    });
    res.status(201).json({ pipeline, stream });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.use('/analyze', analyzeRoutes);

module.exports = { app, pipelineService, halioService, rtmpIngestService, onvifService };
