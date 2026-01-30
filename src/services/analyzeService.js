const { spawn } = require('child_process');
const path = require('path');
const config = require('../config');
const statusService = require('./statusService');

// Vehicle and person classes for summary
const VEHICLE_CLASSES = ['car', 'motorcycle', 'bus', 'truck', 'bicycle'];
const PERSON_CLASSES = ['person'];

/**
 * Analyze an image using Hailo inference
 */
async function analyzeImage(imagePath, options = {}) {
  const startTime = Date.now();
  const modelPath = options.model || config.halioModelPath;
  const scriptPath = path.join(__dirname, '../../scripts/hailo-infer.py');
  
  return new Promise((resolve, reject) => {
    const proc = spawn('python3', [scriptPath, imagePath, modelPath]);
    let stdout = '';
    let stderr = '';
    
    proc.stdout.on('data', (data) => { stdout += data; });
    proc.stderr.on('data', (data) => { stderr += data; });
    
    proc.on('close', (code) => {
      const inferenceTimeMs = Date.now() - startTime;
      
      try {
        const result = JSON.parse(stdout);
        
        if (!result.success) {
          reject(new Error(result.error || 'Inference failed'));
          return;
        }
        
        const detections = result.detections || [];
        
        // Calculate summary
        const vehicles = detections.filter(d => VEHICLE_CLASSES.includes(d.class));
        const people = detections.filter(d => PERSON_CLASSES.includes(d.class));
        
        resolve({
          success: true,
          detections,
          summary: {
            total: detections.length,
            vehicles: vehicles.length,
            people: people.length,
            vehicleTypes: [...new Set(vehicles.map(v => v.class))]
          },
          inferenceTimeMs,
          model: result.model,
          imageSize: result.imageSize
        });
      } catch (e) {
        reject(new Error(`Parse error: ${e.message}. stdout: ${stdout.slice(0, 500)}, stderr: ${stderr.slice(0, 500)}`));
      }
    });
    
    proc.on('error', (err) => {
      reject(new Error(`Process error: ${err.message}`));
    });
  });
}

module.exports = {
  analyzeImage,
  VEHICLE_CLASSES,
  PERSON_CLASSES
};
