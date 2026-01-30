const request = require('supertest');

jest.mock('../src/services/pipelineService', () => ({
  listPipelines: jest.fn().mockReturnValue([{ name: 'mock', manifestPath: '/tmp/mock/index.m3u8', autoInfer: false }]),
  startRtspToHls: jest.fn().mockImplementation((body) => ({
    name: body.name || 'mock',
    manifestPath: '/tmp/mock/index.m3u8',
    autoInfer: !!body.autoInfer,
  })),
  stopPipeline: jest.fn().mockImplementation((name) => ({ name })),
  enableAutoInfer: jest.fn().mockImplementation((name, opts = {}) => ({
    name,
    autoInfer: true,
    modelPath: opts.modelPath || '/models/default',
  })),
  disableAutoInfer: jest.fn().mockImplementation((name) => ({
    name,
    autoInfer: false,
  })),
  getPipeline: jest.fn(),
  on: jest.fn(),
  off: jest.fn(),
}));

jest.mock('../src/services/rtmpIngestService', () => ({
  list: jest.fn().mockReturnValue([{ name: 'stage-feed', manifestPath: '/tmp/rtmp/index.m3u8', autoInfer: false }]),
  start: jest.fn().mockImplementation((body) => ({
    name: body.name || 'rtmp-1',
    manifestPath: '/tmp/rtmp/index.m3u8',
    autoInfer: !!body.autoInfer,
  })),
  stop: jest.fn().mockImplementation((name) => ({ name })),
  enableAutoInfer: jest.fn().mockImplementation((name, opts = {}) => ({
    name,
    autoInfer: true,
    modelPath: opts.modelPath || '/models/default',
  })),
  disableAutoInfer: jest.fn().mockImplementation((name) => ({
    name,
    autoInfer: false,
  })),
  on: jest.fn(),
  off: jest.fn(),
}));

jest.mock('../src/services/onvifService', () => ({
  listCameras: jest.fn().mockReturnValue([{ id: 'lobby-cam', name: 'Lobby Cam', host: '192.168.1.121', port: 80 }]),
  refreshCamera: jest.fn().mockResolvedValue(undefined),
  getProfiles: jest.fn().mockResolvedValue([{ token: 'Profile_1', name: 'MainStream' }]),
  getStreamUri: jest.fn().mockResolvedValue({ uri: 'rtsp://example/live', profileToken: 'Profile_1' }),
  on: jest.fn(),
  off: jest.fn(),
}));

jest.mock('../src/services/halioService', () => ({
  isAvailable: jest.fn().mockResolvedValue(true),
  listModels: jest.fn().mockResolvedValue([{ name: 'modelA' }]),
}));

describe('app routes', () => {
  let app;
  let pipelineService;
  let halioService;
  let rtmpIngestService;
  let onvifService;

  beforeAll(() => {
    const module = require('../src/app');
    app = module.app;
    pipelineService = require('../src/services/pipelineService');
    rtmpIngestService = require('../src/services/rtmpIngestService');
    onvifService = require('../src/services/onvifService');
    halioService = require('../src/services/halioService');
  });

  afterEach(() => {
    jest.clearAllMocks();
    halioService.isAvailable.mockResolvedValue(true);
  });

  it('responds to /health with halio status', async () => {
    halioService.isAvailable.mockResolvedValueOnce(false);
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', halioAvailable: false });
  });

  it('returns config at /config', async () => {
    const res = await request(app).get('/config');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('port');
  });

  it('returns halio status', async () => {
    const res = await request(app).get('/halio/status');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('available', true);
  });

  it('lists halio models', async () => {
    const res = await request(app).get('/halio/models');
    expect(res.status).toBe(200);
    expect(res.body.models[0]).toHaveProperty('name', 'modelA');
  });

  it('lists pipelines', async () => {
    const res = await request(app).get('/pipelines');
    expect(res.status).toBe(200);
    expect(res.body.pipelines).toHaveLength(1);
    expect(pipelineService.listPipelines).toHaveBeenCalled();
  });

  it('starts pipeline via POST', async () => {
    const payload = { name: 'cam01', rtspUrl: 'rtsp://example' };
    const res = await request(app).post('/pipelines/rtsp-to-hls').send(payload);
    expect(res.status).toBe(201);
    expect(pipelineService.startRtspToHls).toHaveBeenCalledWith(payload);
  });

  it('handles pipeline errors gracefully', async () => {
    pipelineService.startRtspToHls.mockImplementationOnce(() => {
      throw new Error('bad input');
    });
    const res = await request(app).post('/pipelines/rtsp-to-hls').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('bad input');
  });

  it('enables inference for pipeline', async () => {
    const res = await request(app).post('/pipelines/mock/inference/start').send({ modelPath: '/models/custom' });
    expect(res.status).toBe(200);
    expect(pipelineService.enableAutoInfer).toHaveBeenCalledWith('mock', { modelPath: '/models/custom' });
    expect(res.body.pipeline).toMatchObject({ name: 'mock', autoInfer: true });
  });

  it('disables inference for pipeline', async () => {
    const res = await request(app).delete('/pipelines/mock/inference');
    expect(res.status).toBe(200);
    expect(pipelineService.disableAutoInfer).toHaveBeenCalledWith('mock');
  });

  it('stops pipeline via DELETE', async () => {
    const res = await request(app).delete('/pipelines/cam01');
    expect(res.status).toBe(200);
    expect(pipelineService.stopPipeline).toHaveBeenCalledWith('cam01');
  });

  it('returns 404 when stopping missing pipeline', async () => {
    pipelineService.stopPipeline.mockImplementationOnce(() => {
      throw new Error('Pipeline cam99 not found.');
    });
    const res = await request(app).delete('/pipelines/cam99');
    expect(res.status).toBe(404);
  });

  it('lists RTMP ingests', async () => {
    const res = await request(app).get('/ingest/rtmp');
    expect(res.status).toBe(200);
    expect(res.body.ingests).toHaveLength(1);
    expect(rtmpIngestService.list).toHaveBeenCalled();
  });

  it('starts RTMP ingest', async () => {
    const payload = { name: 'stage-feed', rtmpUrl: 'rtmp://example/live' };
    const res = await request(app).post('/ingest/rtmp').send(payload);
    expect(res.status).toBe(201);
    expect(rtmpIngestService.start).toHaveBeenCalledWith(payload);
  });

  it('handles ingest errors gracefully', async () => {
    rtmpIngestService.start.mockImplementationOnce(() => {
      throw new Error('bad rtmp');
    });
    const res = await request(app).post('/ingest/rtmp').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('bad rtmp');
  });

  it('enables inference for ingest', async () => {
    const res = await request(app).post('/ingest/rtmp/stage-feed/inference/start').send({ modelPath: '/models/custom' });
    expect(res.status).toBe(200);
    expect(rtmpIngestService.enableAutoInfer).toHaveBeenCalledWith('stage-feed', { modelPath: '/models/custom' });
  });

  it('disables inference for ingest', async () => {
    const res = await request(app).delete('/ingest/rtmp/stage-feed/inference');
    expect(res.status).toBe(200);
    expect(rtmpIngestService.disableAutoInfer).toHaveBeenCalledWith('stage-feed');
  });

  it('stops RTMP ingest', async () => {
    const res = await request(app).delete('/ingest/rtmp/stage-feed');
    expect(res.status).toBe(200);
    expect(rtmpIngestService.stop).toHaveBeenCalledWith('stage-feed');
  });

  it('lists ONVIF cameras', async () => {
    const res = await request(app).get('/onvif/cameras');
    expect(res.status).toBe(200);
    expect(res.body.cameras).toHaveLength(1);
    expect(onvifService.listCameras).toHaveBeenCalled();
  });

  it('refreshes ONVIF camera session', async () => {
    const res = await request(app).post('/onvif/cameras/lobby-cam/refresh');
    expect(res.status).toBe(200);
    expect(onvifService.refreshCamera).toHaveBeenCalledWith('lobby-cam');
  });

  it('returns ONVIF profiles', async () => {
    const res = await request(app).get('/onvif/cameras/lobby-cam/profiles');
    expect(res.status).toBe(200);
    expect(onvifService.getProfiles).toHaveBeenCalledWith('lobby-cam');
    expect(res.body.profiles[0]).toHaveProperty('token', 'Profile_1');
  });

  it('returns ONVIF stream uri', async () => {
    const res = await request(app).post('/onvif/cameras/lobby-cam/stream-uri').send({ profileToken: 'Profile_1' });
    expect(res.status).toBe(200);
    expect(onvifService.getStreamUri).toHaveBeenCalledWith('lobby-cam', 'Profile_1');
    expect(res.body.stream.uri).toContain('rtsp://');
  });

  it('starts pipeline from ONVIF camera', async () => {
    const res = await request(app).post('/onvif/cameras/lobby-cam/start-pipeline').send({ name: 'lobby-rtsp', autoInfer: true });
    expect(res.status).toBe(201);
    expect(onvifService.getStreamUri).toHaveBeenCalledWith('lobby-cam', undefined);
    expect(pipelineService.startRtspToHls).toHaveBeenCalledWith(expect.objectContaining({
      name: 'lobby-rtsp',
      rtspUrl: 'rtsp://example/live',
      autoInfer: true,
    }));
  });
});
