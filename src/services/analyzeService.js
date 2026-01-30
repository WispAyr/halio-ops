const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const config = require('../config');

// COCO class names
const COCO_CLASSES = [
  'person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck', 'boat',
  'traffic light', 'fire hydrant', 'stop sign', 'parking meter', 'bench', 'bird', 'cat',
  'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra', 'giraffe', 'backpack',
  'umbrella', 'handbag', 'tie', 'suitcase', 'frisbee', 'skis', 'snowboard', 'sports ball',
  'kite', 'baseball bat', 'baseball glove', 'skateboard', 'surfboard', 'tennis racket',
  'bottle', 'wine glass', 'cup', 'fork', 'knife', 'spoon', 'bowl', 'banana', 'apple',
  'sandwich', 'orange', 'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake', 'chair',
  'couch', 'potted plant', 'bed', 'dining table', 'toilet', 'tv', 'laptop', 'mouse',
  'remote', 'keyboard', 'cell phone', 'microwave', 'oven', 'toaster', 'sink', 'refrigerator',
  'book', 'clock', 'vase', 'scissors', 'teddy bear', 'hair drier', 'toothbrush'
];

// Vehicle classes for filtering
const VEHICLE_CLASSES = ['car', 'motorcycle', 'bus', 'truck', 'bicycle'];
const PERSON_CLASSES = ['person'];

/**
 * Analyze an image using Hailo inference
 */
async function analyzeImage(imagePath, options = {}) {
  const startTime = Date.now();
  const modelPath = options.model || config.halioModelPath;
  
  return new Promise((resolve, reject) => {
    // Use rpicam-detect for quick inference
    const args = [
      '-t', '1',  // 1ms timeout (single frame)
      '--post-process-file', '/usr/share/rpi-camera-assets/hailo_yolov5_personface.json',
      '--lores-width', '640',
      '--lores-height', '640',
      '-n',  // No preview
      '--immediate',
      '-o', '/dev/null'
    ];
    
    // For file input, use Python script
    const pythonScript = `
import sys
import json
import numpy as np
from PIL import Image
try:
    from hailo_platform import Device, HEF, ConfigureParams, InferVStreams, InputVStreamParams, OutputVStreamParams, FormatType
except ImportError:
    print(json.dumps({"error": "Hailo SDK not available"}))
    sys.exit(1)

def analyze(image_path, model_path):
    try:
        # Load and preprocess image
        img = Image.open(image_path).convert('RGB')
        orig_w, orig_h = img.size
        img_resized = img.resize((640, 640))
        img_array = np.array(img_resized, dtype=np.uint8)
        
        # Initialize Hailo device
        devices = Device.scan()
        if not devices:
            return {"error": "No Hailo device found"}
        
        device = Device(devices[0])
        hef = HEF(model_path)
        
        # Configure network
        configure_params = ConfigureParams.create_from_hef(hef, interface=device.interface)
        network_group = device.configure(hef, configure_params)[0]
        network_group_params = network_group.create_params()
        
        # Get input/output info
        input_vstream_info = hef.get_input_vstream_infos()[0]
        output_vstream_infos = hef.get_output_vstream_infos()
        
        # Setup vstreams
        input_vstreams_params = InputVStreamParams.make(network_group, format_type=FormatType.UINT8)
        output_vstreams_params = OutputVStreamParams.make(network_group, format_type=FormatType.FLOAT32)
        
        detections = []
        
        with InferVStreams(network_group, input_vstreams_params, output_vstreams_params) as infer_pipeline:
            input_data = {input_vstream_info.name: np.expand_dims(img_array, 0)}
            
            with network_group.activate(network_group_params):
                results = infer_pipeline.infer(input_data)
                
                # Parse results (format depends on model)
                for output_info in output_vstream_infos:
                    output = results[output_info.name]
                    # Simple threshold-based detection parsing
                    if len(output.shape) >= 2:
                        for det in output[0]:
                            if len(det) >= 6:
                                conf = float(det[4])
                                if conf > 0.3:
                                    class_id = int(det[5]) if len(det) > 5 else 0
                                    detections.append({
                                        "class_id": class_id,
                                        "confidence": round(conf, 3),
                                        "bbox": {
                                            "x1": round(float(det[0]) * orig_w / 640, 1),
                                            "y1": round(float(det[1]) * orig_h / 640, 1),
                                            "x2": round(float(det[2]) * orig_w / 640, 1),
                                            "y2": round(float(det[3]) * orig_h / 640, 1)
                                        }
                                    })
        
        return {
            "detections": detections,
            "image_size": {"width": orig_w, "height": orig_h},
            "model": model_path.split("/")[-1]
        }
        
    except Exception as e:
        return {"error": str(e), "type": type(e).__name__}

if __name__ == "__main__":
    result = analyze(sys.argv[1], sys.argv[2])
    print(json.dumps(result))
`;
    
    const tmpScript = path.join(os.tmpdir(), 'hailo_analyze.py');
    fs.writeFileSync(tmpScript, pythonScript);
    
    const proc = spawn('python3', [tmpScript, imagePath, modelPath]);
    let stdout = '';
    let stderr = '';
    
    proc.stdout.on('data', (data) => { stdout += data; });
    proc.stderr.on('data', (data) => { stderr += data; });
    
    proc.on('close', (code) => {
      const processingMs = Date.now() - startTime;
      
      try {
        const result = JSON.parse(stdout);
        
        if (result.error) {
          reject(new Error(result.error));
          return;
        }
        
        // Enrich detections with class names and metadata
        const detections = (result.detections || []).map(det => ({
          ...det,
          class_name: COCO_CLASSES[det.class_id] || 'unknown'
        }));
        
        // Calculate summary stats
        const vehicles = detections.filter(d => VEHICLE_CLASSES.includes(d.class_name));
        const people = detections.filter(d => PERSON_CLASSES.includes(d.class_name));
        
        resolve({
          detections,
          summary: {
            total: detections.length,
            vehicles: vehicles.length,
            people: people.length,
            vehicleTypes: vehicles.map(v => v.class_name)
          },
          processingMs,
          model: result.model,
          imageSize: result.image_size
        });
      } catch (e) {
        reject(new Error(`Failed to parse inference result: ${e.message}. stdout: ${stdout}, stderr: ${stderr}`));
      }
    });
  });
}

/**
 * Quick analyze using rpicam-detect (faster, uses camera or file)
 */
async function quickAnalyze(imagePath) {
  const startTime = Date.now();
  
  return new Promise((resolve, reject) => {
    // Use hailortcli for quick inference
    const proc = spawn('hailortcli', [
      'run', config.halioModelPath,
      '--input-files', imagePath
    ]);
    
    let stdout = '';
    let stderr = '';
    
    proc.stdout.on('data', (data) => { stdout += data; });
    proc.stderr.on('data', (data) => { stderr += data; });
    
    proc.on('close', (code) => {
      const processingMs = Date.now() - startTime;
      
      resolve({
        raw: stdout,
        processingMs,
        exitCode: code
      });
    });
  });
}

module.exports = {
  analyzeImage,
  quickAnalyze,
  COCO_CLASSES,
  VEHICLE_CLASSES
};
