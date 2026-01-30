const http = require('http');
const WebSocket = require('ws');
const { app, pipelineService, rtmpIngestService, onvifService } = require('./app');
const config = require('./config');

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/events' });

function attachServiceEvents(ws, service, contextKey) {
  const logHandler = (payload) => {
    ws.send(JSON.stringify({ type: 'pipeline-log', context: contextKey, ...payload }));
  };

  const inferenceHandler = (payload) => {
    ws.send(JSON.stringify({ type: 'inference-result', context: contextKey, ...payload }));
  };

  service.on('log', logHandler);
  service.on('inference-result', inferenceHandler);

  return () => {
    service.off('log', logHandler);
    service.off('inference-result', inferenceHandler);
  };
}

wss.on('connection', (ws) => {
  const detachPipeline = attachServiceEvents(ws, pipelineService, 'rtsp');
  const detachIngest = attachServiceEvents(ws, rtmpIngestService, 'rtmp');
  const detachOnvif = attachServiceEvents(ws, onvifService, 'onvif');

  ws.on('close', () => {
    detachPipeline();
    detachIngest();
    detachOnvif();
  });
});

if (require.main === module) {
  server.listen(config.port, () => {
    console.log(`[halio-ops] listening on port ${config.port}`);
  });
}

module.exports = server;
