const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');
const chokidar = require('chokidar');
const config = require('../config');
const { loadExeca } = require('../utils/execa');

class HalioService extends EventEmitter {
  constructor() {
    super();
    this.watchers = new Map();
  }

  async isAvailable() {
    try {
      const execa = await loadExeca();
      // Check if Hailo device is available
      await execa('hailortcli', ['scan']);
      return true;
    } catch (err) {
      this.emit('log', {
        level: 'warn',
        message: `Hailo device check failed: ${err.shortMessage || err.message}`,
      });
      return false;
    }
  }

  async listModels() {
    try {
      // List .hef model files from standard Hailo models directory
      const modelsDir = '/usr/share/hailo-models';
      if (!fs.existsSync(modelsDir)) {
        return [];
      }
      const files = fs.readdirSync(modelsDir).filter(f => f.endsWith('.hef'));
      return files.map(f => ({
        name: f,
        path: `${modelsDir}/${f}`,
        size: fs.statSync(`${modelsDir}/${f}`).size,
      }));
    } catch (err) {
      this.emit('log', {
        level: 'error',
        message: `Failed to list Hailo models: ${err.message}`,
      });
      throw err;
    }
  }

  startInferenceWatcher(pipelineName, outputDir, {
    modelPath = config.halioModelPath,
    debounceMs = 500,
    maxConcurrent = 1,
  } = {}) {
    if (this.watchers.has(pipelineName)) {
      throw new Error(`Inference watcher already running for ${pipelineName}`);
    }

    if (!modelPath) {
      throw new Error('HALIO model path not configured. Set HALIO_MODEL_PATH in environment.');
    }

    const resolvedModel = path.resolve(modelPath);
    // Check if model exists, but only warn - we'll check again when running inference
    if (!fs.existsSync(resolvedModel)) {
      this.emit('log', {
        pipeline: pipelineName,
        level: 'warn',
        message: `HALIO model file not found: ${resolvedModel}. Inference will be skipped until model is available.`,
      });
    }

    const resolvedDir = path.resolve(outputDir);
    if (!fs.existsSync(resolvedDir)) {
      throw new Error(`Pipeline output directory ${resolvedDir} missing`);
    }

    const state = {
      watcher: null,
      queue: [],
      running: 0,
      debounceMs,
      maxConcurrent,
      timer: null,
      modelPath,
    };

    const processQueue = async () => {
      if (state.running >= state.maxConcurrent || state.queue.length === 0) {
        return;
      }

      const segmentPath = state.queue.shift();
      state.running += 1;

      try {
        await this.runInference(pipelineName, segmentPath, { modelPath: state.modelPath });
      } catch (err) {
        this.emit('log', {
          pipeline: pipelineName,
          level: 'error',
          message: `Inference failed for ${segmentPath}: ${err.shortMessage || err.message}`,
        });
      } finally {
        state.running -= 1;
        setImmediate(processQueue);
      }
    };

    const scheduleRun = () => {
      if (state.timer) {
        clearTimeout(state.timer);
      }
      state.timer = setTimeout(() => {
        state.timer = null;
        processQueue();
      }, state.debounceMs);
    };

    const watcher = chokidar.watch(path.join(resolvedDir, '*.ts'), {
      ignoreInitial: false,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 100,
      },
    });

    watcher.on('add', (filePath) => {
      state.queue.push(filePath);
      this.emit('log', {
        pipeline: pipelineName,
        level: 'info',
        message: `Segment detected: ${path.basename(filePath)} - queued for inference`,
      });
      scheduleRun();
    });

    watcher.on('error', (error) => {
      this.emit('log', {
        pipeline: pipelineName,
        level: 'error',
        message: `Watcher error: ${error.message}`,
      });
    });

    watcher.on('ready', () => {
      const existingFiles = fs.readdirSync(resolvedDir).filter(f => f.endsWith('.ts'));
      this.emit('log', {
        pipeline: pipelineName,
        level: 'info',
        message: `Inference watcher ready (model: ${state.modelPath}). Found ${existingFiles.length} existing segments.`,
      });
      // Process existing segments
      existingFiles.forEach(file => {
        const filePath = path.join(resolvedDir, file);
        if (fs.existsSync(filePath)) {
          state.queue.push(filePath);
          this.emit('log', {
            pipeline: pipelineName,
            level: 'info',
            message: `Queued existing segment: ${file} for inference`,
          });
        }
      });
      if (existingFiles.length > 0) {
        scheduleRun();
      }
    });

    state.watcher = watcher;
    this.watchers.set(pipelineName, state);
  }

  stopInferenceWatcher(pipelineName) {
    const state = this.watchers.get(pipelineName);
    if (!state) {
      throw new Error(`No inference watcher running for ${pipelineName}`);
    }
    if (state.timer) {
      clearTimeout(state.timer);
    }
    state.watcher.close();
    this.watchers.delete(pipelineName);
    this.emit('log', {
      pipeline: pipelineName,
      level: 'info',
      message: 'Stopped inference watcher',
    });
  }

  async runInference(pipelineName, segmentPath, { modelPath } = {}) {
    const resolvedModel = modelPath || config.halioModelPath;
    if (!resolvedModel) {
      throw new Error('HALIO model path not configured');
    }

    const resolvedModelPath = path.resolve(resolvedModel);
    if (!fs.existsSync(resolvedModelPath)) {
      this.emit('log', {
        pipeline: pipelineName,
        level: 'warn',
        message: `Skipping inference for ${path.basename(segmentPath)} - model file not found: ${resolvedModelPath}`,
      });
      // Emit a result indicating inference was skipped
      this.emit('inference-result', {
        pipeline: pipelineName,
        segment: path.basename(segmentPath),
        outputPath: null,
        modelPath: resolvedModelPath,
        data: null,
        stdout: '',
        stderr: 'Model file not found',
        timestamp: new Date().toISOString(),
        skipped: true,
      });
      return; // Skip inference if model doesn't exist
    }

    // Extract frame from MPEG-TS segment and convert to Hailo format
    const framePath = `${segmentPath}.frame.raw`;
    const outputPath = `${segmentPath}.json`;
    
    // Extract first frame: 640x640 RGB (1228800 bytes)
    const execa = await loadExeca();
    let stdout, stderr;
    
    try {
      // Extract frame from video segment
      await execa('ffmpeg', [
        '-i', segmentPath,
        '-frames:v', '1',
        '-f', 'rawvideo',
        '-pix_fmt', 'rgb24',
        '-s', '640x640',
        '-y',
        framePath,
      ], { all: false });
      
      // Run Hailo inference on extracted frame (performance metrics)
      const args = [
        'run',
        resolvedModelPath,
        '--input-files', framePath,
        '--csv', outputPath,
        '--frames-count', '1',
      ];
      
      const result = await execa('hailortcli', args, { all: false });
      stdout = result.stdout;
      stderr = result.stderr;
      
      // Also extract actual detections using Python script
      // Note: This is optional - if it fails, we still have performance metrics
      const detectionsPath = `${segmentPath}.detections.json`;
      let detections = null;
      try {
        const pythonScript = path.join(__dirname, '../../scripts/get-detections.py');
        const detResult = await execa('python3', [
          pythonScript,
          resolvedModelPath,
          framePath,
          detectionsPath,
        ], { 
          all: false,
          timeout: 10000, // 10 second timeout
        });
        
        if (fs.existsSync(detectionsPath)) {
          const detectionsContent = fs.readFileSync(detectionsPath, 'utf8');
          const parsed = JSON.parse(detectionsContent);
          if (parsed.success && parsed.detections) {
            detections = parsed;
          }
        }
      } catch (detErr) {
        // Detection extraction is optional - log but continue
        // The performance metrics are still available
        this.emit('log', {
          pipeline: pipelineName,
          level: 'debug',
          message: `Detection extraction not available (using performance metrics only): ${detErr.message}`,
        });
      }
      
      // Clean up frame file
      if (fs.existsSync(framePath)) {
        fs.unlinkSync(framePath);
      }
    } catch (err) {
      this.emit('log', {
        pipeline: pipelineName,
        level: 'error',
        message: `Inference execution failed: ${err.shortMessage || err.message}`,
      });
      throw err;
    }

    let parsed = null;
    
    // Wait a moment for file to be fully written
    await new Promise(resolve => setTimeout(resolve, 100));
    
    if (fs.existsSync(outputPath)) {
      try {
        const content = fs.readFileSync(outputPath, 'utf8');
        
        // Check if it's already JSON
        if (content.trim().startsWith('{')) {
          try {
            parsed = JSON.parse(content);
            this.emit('log', {
              pipeline: pipelineName,
              level: 'debug',
              message: `Loaded existing JSON: ${path.basename(outputPath)}`,
            });
          } catch (e) {
            this.emit('log', {
              pipeline: pipelineName,
              level: 'warn',
              message: `Failed to parse existing JSON: ${e.message}`,
            });
          }
        } else {
          // Parse CSV output from hailortcli
          this.emit('log', {
            pipeline: pipelineName,
            level: 'debug',
            message: `Converting CSV to JSON: ${path.basename(outputPath)}`,
          });
          
          const lines = content.trim().split('\n');
          if (lines.length >= 2) {
            const headers = lines[0].split(',');
            const values = lines[1].split(',');
            parsed = {
              network: values[0] || null,
              status: values[1] || null,
              statusDescription: values[2] || null,
              fps: parseFloat(values[3]) || null,
              numFrames: parseInt(values[4]) || null,
              sendRate: parseFloat(values[5]) || null,
              recvRate: parseFloat(values[6]) || null,
              hwLatency: values[7] || null,
              overallLatency: values[8] || null,
              raw: Object.fromEntries(headers.map((h, i) => [h, values[i] || null])),
            };
            
            // Add detection results if available
            if (detections && detections.success) {
              parsed.detections = detections.detections || [];
              parsed.detectionCount = detections.count || 0;
              parsed.detectionSummary = detections.summary || {};
            }
            
            // Always write JSON version (overwrite CSV)
            try {
              const jsonContent = JSON.stringify(parsed, null, 2);
              // Use writeFileSync with explicit encoding to ensure file is written
              fs.writeFileSync(outputPath, jsonContent, { encoding: 'utf8', flag: 'w' });
              this.emit('log', {
                pipeline: pipelineName,
                level: 'info',
                message: `Converted CSV to JSON: ${path.basename(outputPath)} (${jsonContent.length} bytes)`,
              });
            } catch (writeErr) {
              this.emit('log', {
                pipeline: pipelineName,
                level: 'error',
                message: `Failed to write JSON: ${writeErr.message}`,
              });
              // Don't throw - continue with parsed data even if write fails
            }
          } else {
            this.emit('log', {
              pipeline: pipelineName,
              level: 'warn',
              message: `Invalid CSV format in ${path.basename(outputPath)}: expected at least 2 lines, got ${lines.length}`,
            });
          }
        }
      } catch (err) {
        this.emit('log', {
          pipeline: pipelineName,
          level: 'error',
          message: `Failed to parse inference output ${outputPath}: ${err.message}`,
        });
      }
    } else {
      this.emit('log', {
        pipeline: pipelineName,
        level: 'warn',
        message: `Inference output file not found: ${path.basename(outputPath)}`,
      });
    }

    // Always emit inference result, even if parsing failed
    // This ensures the UI gets updates
    if (!parsed) {
      // Create minimal result if parsing completely failed
      parsed = {
        network: 'unknown',
        status: '1',
        statusDescription: 'PARSE_ERROR',
        fps: null,
        numFrames: null,
        error: 'Failed to parse inference output',
      };
    }
    
    this.emit('inference-result', {
      pipeline: pipelineName,
      segment: path.basename(segmentPath),
      outputPath,
      modelPath: resolvedModel,
      data: parsed,
      stdout: stdout ? stdout.trim() : '',
      stderr: stderr ? stderr.trim() : '',
      timestamp: new Date().toISOString(),
    });
    
    this.emit('log', {
      pipeline: pipelineName,
      level: 'info',
      message: `Inference completed for ${path.basename(segmentPath)}: ${parsed.detectionCount || 0} detections, ${parsed.fps ? parsed.fps.toFixed(1) : 'N/A'} FPS`,
    });
  }
}

module.exports = new HalioService();
