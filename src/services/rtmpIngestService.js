const { EventEmitter } = require('events');
const path = require('path');
const { mkdirSync } = require('fs');
const config = require('../config');
const halioService = require('./halioService');
const { loadExeca } = require('../utils/execa');

class RtmpIngestService extends EventEmitter {
  constructor() {
    super();
    this.streams = new Map();
  }

  async start({ name, rtmpUrl, outputDir, segmentTime = 6, autoInfer = config.autoInfer, modelPath } = {}) {
    if (!rtmpUrl) {
      throw new Error('rtmpUrl is required');
    }

    const streamName = name || `rtmp-${Date.now()}`;
    if (this.streams.has(streamName)) {
      throw new Error(`Ingest ${streamName} already exists.`);
    }

    const baseDir = outputDir || config.rtmpStorage;
    const resolvedOutput = path.resolve(baseDir, streamName);
    mkdirSync(resolvedOutput, { recursive: true });

    const manifestPath = path.join(resolvedOutput, 'index.m3u8');
    const segmentPattern = path.join(resolvedOutput, 'segment-%05d.ts');

    const args = [
      '-y',
      '-i', rtmpUrl,
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-ar', '44100',
      '-f', 'hls',
      '-hls_time', String(segmentTime),
      '-hls_list_size', '6',
      '-hls_flags', 'delete_segments+append_list+program_date_time',
      '-hls_segment_filename', segmentPattern,
      manifestPath,
    ];

    const execa = await loadExeca();
    const child = execa('ffmpeg', args, { all: true });

    if (typeof child.all?.on === 'function') {
      child.all.on('data', (chunk) => {
        this.emit('log', {
          stream: streamName,
          level: 'info',
          message: chunk.toString(),
        });
      });
    } else {
      child.stdout?.on('data', (chunk) => {
        this.emit('log', {
          stream: streamName,
          level: 'info',
          message: chunk.toString(),
        });
      });
      child.stderr?.on('data', (chunk) => {
        this.emit('log', {
          stream: streamName,
          level: 'error',
          message: chunk.toString(),
        });
      });
    }

    const cleanup = () => {
      const entry = this.streams.get(streamName);
      if (!entry) return;
      if (entry.autoInfer) {
        try {
          this.disableAutoInfer(streamName);
        } catch (err) {
          this.emit('log', {
            stream: streamName,
            level: 'warn',
            message: `Failed to disable inference on cleanup: ${err.message}`,
          });
        }
      }
      this.streams.delete(streamName);
    };

    child.on('exit', (code, signal) => {
      this.emit('log', {
        stream: streamName,
        level: code === 0 ? 'info' : 'error',
        message: `Ingest exited with code ${code} signal ${signal}`,
      });
      cleanup();
    });

    child.on('error', (err) => {
      this.emit('log', {
        stream: streamName,
        level: 'error',
        message: `Ingest error: ${err.message}`,
      });
      cleanup();
    });

    if (typeof child.cancel !== 'function') {
      child.cancel = (reason) => {
        this.emit('log', {
          stream: streamName,
          level: 'info',
          message: `Ingest cancellation requested${reason ? `: ${reason}` : ''}`,
        });
        child.kill('SIGTERM');
      };
    }

    const manifestUrl = `/media/rtmp/${encodeURIComponent(streamName)}/index.m3u8`;

    this.streams.set(streamName, {
      process: child,
      manifestPath,
      manifestUrl,
      outputDir: resolvedOutput,
      autoInfer: false,
      modelPath: modelPath || config.halioModelPath || null,
      halioListeners: null,
    });

    if (autoInfer) {
      try {
        this.enableAutoInfer(streamName, { modelPath });
      } catch (err) {
        this.emit('log', {
          stream: streamName,
          level: 'error',
          message: `Failed to enable auto inference: ${err.message}`,
        });
      }
    }

    return this.get(streamName);
  }

  stop(name) {
    const entry = this.streams.get(name);
    if (!entry) {
      throw new Error(`Ingest ${name} not found.`);
    }

    if (entry.autoInfer) {
      try {
        this.disableAutoInfer(name);
      } catch (err) {
        this.emit('log', {
          stream: name,
          level: 'warn',
          message: `Inference watcher stop failed: ${err.message}`,
        });
      }
    }

    if (typeof entry.process.cancel === 'function') {
      entry.process.cancel('Ingest stopped by user');
    } else {
      entry.process.kill('SIGTERM');
    }
    this.streams.delete(name);
    return { name };
  }

  enableAutoInfer(name, { modelPath } = {}) {
    const entry = this.streams.get(name);
    if (!entry) {
      throw new Error(`Ingest ${name} not found.`);
    }
    if (entry.autoInfer) {
      throw new Error(`Inference already active for ${name}`);
    }

    const resolvedModel = modelPath || entry.modelPath || config.halioModelPath;
    halioService.startInferenceWatcher(name, entry.outputDir, { modelPath: resolvedModel });

    const inferenceHandler = (payload) => {
      if (payload.pipeline === name) {
        this.emit('inference-result', { ...payload, stream: name });
      }
    };
    const logHandler = (payload) => {
      if (payload.pipeline === name) {
        this.emit('log', { ...payload, stream: name });
      }
    };

    halioService.on('inference-result', inferenceHandler);
    halioService.on('log', logHandler);

    entry.autoInfer = true;
    entry.modelPath = resolvedModel;
    entry.halioListeners = { inferenceHandler, logHandler };

    return this.get(name);
  }

  disableAutoInfer(name) {
    const entry = this.streams.get(name);
    if (!entry) {
      throw new Error(`Ingest ${name} not found.`);
    }
    if (!entry.autoInfer) {
      throw new Error(`Inference is not active for ${name}`);
    }

    halioService.stopInferenceWatcher(name);
    if (entry.halioListeners) {
      const { inferenceHandler, logHandler } = entry.halioListeners;
      if (inferenceHandler) halioService.off('inference-result', inferenceHandler);
      if (logHandler) halioService.off('log', logHandler);
      entry.halioListeners = null;
    }

    entry.autoInfer = false;
    return this.get(name);
  }

  list() {
    return Array.from(this.streams.entries()).map(([name, info]) => ({
      name,
      manifestPath: info.manifestPath,
      manifestUrl: info.manifestUrl,
      outputDir: info.outputDir,
      autoInfer: info.autoInfer,
      modelPath: info.modelPath,
    }));
  }

  get(name) {
    const entry = this.streams.get(name);
    if (!entry) {
      throw new Error(`Ingest ${name} not found.`);
    }
    return {
      name,
      manifestPath: entry.manifestPath,
      manifestUrl: entry.manifestUrl,
      outputDir: entry.outputDir,
      autoInfer: entry.autoInfer,
      modelPath: entry.modelPath,
    };
  }
}

module.exports = new RtmpIngestService();
