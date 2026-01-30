const { EventEmitter } = require('events');
const path = require('path');
const { mkdirSync } = require('fs');
const config = require('../config');
const halioService = require('./halioService');
const { loadExeca } = require('../utils/execa');

const PUBLIC_BASE = {
  rtsp: '/media/pipelines',
  rtmp: '/media/rtmp',
};

const STORAGE_BASE = {
  rtsp: () => config.pipelineStorage,
  rtmp: () => config.rtmpStorage,
};

function buildFfmpegArgs({
  input,
  outputDir,
  manifestPath,
  segmentTime,
  videoCodec,
  audioCodec,
  isRtsp,
}) {
  const args = [
    '-hide_banner',
    '-loglevel', 'info',
  ];

  if (isRtsp) {
    args.push('-rtsp_transport', 'tcp');
    // Handle RTSPS (secure RTSP) - improved stability
    if (input.startsWith('rtsps://')) {
      args.push('-rtsp_flags', 'prefer_tcp');
      args.push('-allowed_media_types', 'video');
      // RTSPS-specific: use TCP transport for better stability
      // Note: reconnect options are HTTP-specific, not available for RTSP
    }
  }

  args.push('-i', input);
  args.push('-c:v', videoCodec);

  if (videoCodec === 'libx264') {
    // Scale to 720p for optimal performance: faster inference, better browser playback, lower bandwidth
    // force_original_aspect_ratio=decrease maintains aspect ratio without padding
    args.push('-vf', 'scale=1280:720:force_original_aspect_ratio=decrease');
    args.push('-preset', 'veryfast', '-tune', 'zerolatency', '-pix_fmt', 'yuv420p');
  }

  args.push('-c:a', audioCodec);
  args.push(
    '-f', 'hls',
    '-hls_time', String(segmentTime),
    '-hls_list_size', '6',
    '-hls_flags', 'delete_segments+append_list+independent_segments+omit_endlist',
    '-hls_segment_filename', path.join(outputDir, 'segment-%05d.ts'),
    '-fflags', '+genpts+flush_packets',
    '-avoid_negative_ts', 'make_zero',
    '-flags', '+global_header',
    manifestPath,
  );

  return args;
}

class PipelineService extends EventEmitter {
  constructor() {
    super();
    this.pipelines = new Map();
  }

  async startRtspToHls({
    name,
    rtspUrl,
    outputDir,
    segmentTime = 6,
    autoInfer = config.autoInfer,
    modelPath,
    videoCodec = 'libx264',
    audioCodec = 'aac',
  } = {}) {
    const source = rtspUrl || config.rtspInputUrl;
    if (!source) {
      throw new Error('RTSP URL is required');
    }

    const pipelineName = name || `rtsp-hls-${Date.now()}`;

    if (this.pipelines.has(pipelineName)) {
      throw new Error(`Pipeline ${pipelineName} already exists.`);
    }

    const baseDir = outputDir || STORAGE_BASE.rtsp();
    const resolvedOutput = path.resolve(baseDir, pipelineName);
    mkdirSync(resolvedOutput, { recursive: true });

    const manifestPath = path.join(resolvedOutput, 'index.m3u8');
    const ffmpegArgs = buildFfmpegArgs({
      input: source,
      outputDir: resolvedOutput,
      manifestPath,
      segmentTime,
      videoCodec,
      audioCodec,
      isRtsp: true,
    });

    const execa = await loadExeca();
    let child;
    try {
      child = execa('ffmpeg', ffmpegArgs, { all: true });
    } catch (err) {
      throw new Error(`Failed to start FFmpeg pipeline: ${err.shortMessage || err.message}`);
    }

    return this._registerPipeline(pipelineName, child, {
      manifestPath,
      outputDir: resolvedOutput,
      autoInfer,
      modelPath,
      type: 'rtsp',
      // Store pipelineConfig for auto-restart
      pipelineConfig: {
        rtspUrl: source,
        segmentTime,
        videoCodec,
        audioCodec,
        outputDir,
      },
    });
  }

  async startRtmpToHls({
    name,
    rtmpUrl,
    outputDir,
    segmentTime = 6,
    autoInfer = config.autoInfer,
    modelPath,
    videoCodec = 'libx264',
    audioCodec = 'aac',
  } = {}) {
    if (!rtmpUrl) {
      throw new Error('RTMP URL is required');
    }

    const pipelineName = name || `rtmp-hls-${Date.now()}`;

    if (this.pipelines.has(pipelineName)) {
      throw new Error(`Pipeline ${pipelineName} already exists.`);
    }

    const baseDir = outputDir || STORAGE_BASE.rtmp();
    const resolvedOutput = path.resolve(baseDir, pipelineName);
    mkdirSync(resolvedOutput, { recursive: true });

    const manifestPath = path.join(resolvedOutput, 'index.m3u8');
    const ffmpegArgs = buildFfmpegArgs({
      input: rtmpUrl,
      outputDir: resolvedOutput,
      manifestPath,
      segmentTime,
      videoCodec,
      audioCodec,
      isRtsp: false,
    });

    const execa = await loadExeca();
    let child;
    try {
      child = execa('ffmpeg', ffmpegArgs, { all: true });
    } catch (err) {
      throw new Error(`Failed to start FFmpeg ingest: ${err.shortMessage || err.message}`);
    }

    return this._registerPipeline(pipelineName, child, {
      manifestPath,
      outputDir: resolvedOutput,
      autoInfer,
      modelPath,
      type: 'rtmp',
    });
  }

  async startRtmpBatch(sources = []) {
    if (!Array.isArray(sources) || sources.length === 0) {
      throw new Error('sources array is required for RTMP batch start');
    }

    const results = [];
    const errors = [];

    for (const source of sources) {
      try {
        const pipeline = await this.startRtmpToHls(source);
        results.push(pipeline);
      } catch (err) {
        errors.push({ source, error: err.message });
      }
    }

    return { results, errors };
  }

  stopPipeline(name) {
    const pipeline = this.pipelines.get(name);
    if (!pipeline) {
      throw new Error(`Pipeline ${name} not found.`);
    }

    if (pipeline.autoInfer) {
      try {
        this.disableAutoInfer(name);
      } catch (err) {
        this.emit('log', {
          pipeline: name,
          level: 'warn',
          message: `Inference watcher stop failed: ${err.message}`,
        });
      }
    }

    if (typeof pipeline.process.cancel === 'function') {
      pipeline.process.cancel('Pipeline stopped by user');
    } else {
      pipeline.process.kill('SIGTERM');
    }
    this.pipelines.delete(name);
    return { name };
  }

  enableAutoInfer(name, { modelPath } = {}) {
    const pipeline = this.pipelines.get(name);
    if (!pipeline) {
      throw new Error(`Pipeline ${name} not found.`);
    }
    if (pipeline.autoInfer) {
      throw new Error(`Inference already active for ${name}`);
    }

    const resolvedModel = modelPath || pipeline.modelPath || config.halioModelPath;
    halioService.startInferenceWatcher(name, pipeline.outputDir, { modelPath: resolvedModel });

    const inferenceHandler = (payload) => {
      if (payload.pipeline === name) {
        this.emit('inference-result', payload);
      }
    };

    const halioLogHandler = (payload) => {
      if (payload.pipeline === name) {
        this.emit('log', payload);
      }
    };

    halioService.on('inference-result', inferenceHandler);
    halioService.on('log', halioLogHandler);

    pipeline.autoInfer = true;
    pipeline.modelPath = resolvedModel;
    pipeline.halioListeners = { inferenceHandler, halioLogHandler };

    return this.getPipeline(name);
  }

  disableAutoInfer(name) {
    const pipeline = this.pipelines.get(name);
    if (!pipeline) {
      throw new Error(`Pipeline ${name} not found.`);
    }
    if (!pipeline.autoInfer) {
      throw new Error(`Inference is not active for ${name}`);
    }

    halioService.stopInferenceWatcher(name);

    if (pipeline.halioListeners) {
      const { inferenceHandler, halioLogHandler } = pipeline.halioListeners;
      if (inferenceHandler) {
        halioService.off('inference-result', inferenceHandler);
      }
      if (halioLogHandler) {
        halioService.off('log', halioLogHandler);
      }
      pipeline.halioListeners = null;
    }

    pipeline.autoInfer = false;
    return this.getPipeline(name);
  }

  getPipeline(name) {
    const pipeline = this.pipelines.get(name);
    if (!pipeline) {
      throw new Error(`Pipeline ${name} not found.`);
    }
    return {
      name,
      manifestPath: pipeline.manifestPath,
      manifestUrl: pipeline.manifestUrl,
      outputDir: pipeline.outputDir,
      autoInfer: pipeline.autoInfer,
      modelPath: pipeline.modelPath,
      type: pipeline.type,
    };
  }

  listPipelines() {
    return Array.from(this.pipelines.entries()).map(([name, info]) => ({
      name,
      manifestPath: info.manifestPath,
      manifestUrl: info.manifestUrl,
      outputDir: info.outputDir,
      autoInfer: info.autoInfer,
      modelPath: info.modelPath,
      type: info.type,
    }));
  }

  _registerPipeline(pipelineName, child, { manifestPath, outputDir, autoInfer, modelPath, type, pipelineConfig = null }) {
    if (typeof child.all?.on === 'function') {
      child.all.on('data', (chunk) => {
        this.emit('log', { pipeline: pipelineName, level: 'info', message: chunk.toString() });
      });
    } else {
      child.stdout?.on('data', (chunk) => {
        this.emit('log', { pipeline: pipelineName, level: 'info', message: chunk.toString() });
      });
      child.stderr?.on('data', (chunk) => {
        this.emit('log', { pipeline: pipelineName, level: 'error', message: chunk.toString() });
      });
    }

    const cleanup = () => {
      const pipeline = this.pipelines.get(pipelineName);
      if (!pipeline) {
        return;
      }
      if (pipeline.autoInfer) {
        try {
          this.disableAutoInfer(pipelineName);
        } catch (err) {
          this.emit('log', {
            pipeline: pipelineName,
            level: 'warn',
            message: `Failed to disable inference on cleanup: ${err.message}`,
          });
        }
      }
      this.pipelines.delete(pipelineName);
    };

    child.on('exit', async (code, signal) => {
      const pipeline = this.pipelines.get(pipelineName);
      if (!pipeline) {
        return;
      }

      this.emit('log', {
        pipeline: pipelineName,
        level: code === 0 ? 'info' : 'error',
        message: `Pipeline exited with code ${code} signal ${signal}`,
      });

      // Auto-restart logic - restart on errors OR if RTSPS stream exits cleanly (connection drop)
      const isRtsps = pipeline.restartConfig?.rtspUrl?.startsWith('rtsps://');
      const shouldRestart = (code !== 0 || (code === 0 && isRtsps)) 
        && pipeline.restartConfig 
        && pipeline.restartCount < pipeline.maxRestarts;
        
      if (shouldRestart) {
        const now = Date.now();
        const timeSinceLastRestart = pipeline.lastRestartTime ? now - pipeline.lastRestartTime : Infinity;
        // Faster restart for RTSPS (they need quick reconnection)
        const baseDelay = isRtsps ? 2000 : 1000;
        const backoffDelay = Math.min(baseDelay * Math.pow(2, Math.min(pipeline.restartCount, 3)), isRtsps ? 10000 : 30000);

        if (timeSinceLastRestart >= backoffDelay) {
          pipeline.restartCount++;
          pipeline.lastRestartTime = now;

          this.emit('log', {
            pipeline: pipelineName,
            level: 'warn',
            message: `Auto-restarting pipeline (attempt ${pipeline.restartCount}/${pipeline.maxRestarts}) after ${Math.round(backoffDelay / 1000)}s delay...`,
          });

          // Store state before cleanup
          const savedAutoInfer = pipeline.autoInfer;
          const savedModelPath = pipeline.modelPath;
          const savedRestartConfig = pipeline.restartConfig;
          const savedRestartCount = pipeline.restartCount;
          const savedMaxRestarts = pipeline.maxRestarts;

          // Clean up old process but keep pipeline entry temporarily
          if (pipeline.autoInfer) {
            try {
              this.disableAutoInfer(pipelineName);
            } catch (err) {
              // Ignore errors during cleanup
            }
          }
          // Remove from map temporarily to allow restart
          this.pipelines.delete(pipelineName);

          // Wait for backoff delay
          await new Promise(resolve => setTimeout(resolve, backoffDelay));

          // Restart the pipeline
          try {
            if (type === 'rtsp') {
              const newPipeline = await this.startRtspToHls({
                name: pipelineName,
                ...savedRestartConfig,
                autoInfer: savedAutoInfer,
                modelPath: savedModelPath,
              });
              // Restore restart tracking
              const restartedPipeline = this.pipelines.get(pipelineName);
              if (restartedPipeline) {
                restartedPipeline.restartCount = savedRestartCount;
                restartedPipeline.maxRestarts = savedMaxRestarts;
              }
              this.emit('log', {
                pipeline: pipelineName,
                level: 'info',
                message: `Pipeline restarted successfully`,
              });
            }
          } catch (err) {
            this.emit('log', {
              pipeline: pipelineName,
              level: 'error',
              message: `Failed to restart pipeline: ${err.message}`,
            });
            // Final cleanup on restart failure
            const failedPipeline = this.pipelines.get(pipelineName);
            if (failedPipeline) {
              if (failedPipeline.autoInfer) {
                try {
                  this.disableAutoInfer(pipelineName);
                } catch (e) {}
              }
              this.pipelines.delete(pipelineName);
            }
          }
          return;
        }
      }

      cleanup();
    });

    child.on('error', (err) => {
      this.emit('log', {
        pipeline: pipelineName,
        level: 'error',
        message: `Pipeline error: ${err.message}`,
      });
      cleanup();
    });

    if (typeof child.catch === 'function') {
      child.catch((err) => {
        this.emit('log', {
          pipeline: pipelineName,
          level: 'error',
          message: `Pipeline failed to launch: ${err.shortMessage || err.message}`,
        });
        cleanup();
      });
    }

    if (typeof child.cancel !== 'function') {
      child.cancel = (reason) => {
        this.emit('log', {
          pipeline: pipelineName,
          level: 'info',
          message: `Pipeline cancellation requested${reason ? `: ${reason}` : ''}`,
        });
        child.kill('SIGTERM');
      };
    }

    const manifestUrl = `${PUBLIC_BASE[type]}/${encodeURIComponent(pipelineName)}/index.m3u8`;

    const appConfig = require('../config');
    this.pipelines.set(pipelineName, {
      process: child,
      manifestPath,
      manifestUrl,
      outputDir,
      autoInfer: false,
      modelPath: modelPath || appConfig.halioModelPath || null,
      halioListeners: null,
      type,
      restartConfig: pipelineConfig, // Store pipeline config for auto-restart
      restartCount: 0,
      maxRestarts: 10, // Max restart attempts
      lastRestartTime: null,
    });

    if (autoInfer) {
      try {
        this.enableAutoInfer(pipelineName, { modelPath });
        this.emit('log', {
          pipeline: pipelineName,
          level: 'info',
          message: `Auto inference enabled (model: ${modelPath || appConfig.halioModelPath || 'default'})`,
        });
      } catch (err) {
        this.emit('log', {
          pipeline: pipelineName,
          level: 'error',
          message: `Failed to enable auto inference: ${err.message}`,
        });
        // Don't fail pipeline creation if inference setup fails
        console.error(`[pipelineService] Failed to enable inference for ${pipelineName}:`, err.message);
      }
    }

    return this.getPipeline(pipelineName);
  }
}

module.exports = new PipelineService();
