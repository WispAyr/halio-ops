#!/usr/bin/env python3
"""
Extract actual detection results from Hailo inference.
Returns JSON with bounding boxes, classes, and confidence scores.
"""
import sys
import json
import numpy as np
from pathlib import Path

try:
    from hailo_platform import Device, InferVStreams, HEF
except ImportError:
    print(json.dumps({"error": "Hailo Python API not available"}), file=sys.stderr)
    sys.exit(1)

def parse_detections(output_data, num_classes=80, max_boxes_per_class=100):
    """
    Parse YOLOv8 NMS output format.
    Format: [batch, num_classes, max_boxes_per_class, 6]
    Where 6 = [x_center, y_center, width, height, confidence, class_id]
    """
    detections = []
    
    if output_data is None or len(output_data) == 0:
        return detections
    
    # Reshape based on expected format
    # YOLOv8 NMS output: [num_classes, max_boxes_per_class, 6]
    try:
        data = np.array(output_data)
        # Flatten and reshape
        if data.size > 0:
            # Expected shape: [num_classes * max_boxes_per_class * 6]
            # Reshape to [num_classes, max_boxes_per_class, 6]
            total_elements = num_classes * max_boxes_per_class * 6
            if data.size >= total_elements:
                data = data[:total_elements].reshape(num_classes, max_boxes_per_class, 6)
                
                for class_id in range(num_classes):
                    for box_idx in range(max_boxes_per_class):
                        box = data[class_id, box_idx]
                        x_center, y_center, width, height, confidence, detected_class = box
                        
                        # Filter out low confidence detections
                        if confidence > 0.2:  # Match model's score threshold
                            detections.append({
                                "class_id": int(detected_class),
                                "confidence": float(confidence),
                                "bbox": {
                                    "x_center": float(x_center),
                                    "y_center": float(y_center),
                                    "width": float(width),
                                    "height": float(height),
                                    "x1": float(x_center - width / 2),
                                    "y1": float(y_center - height / 2),
                                    "x2": float(x_center + width / 2),
                                    "y2": float(y_center + height / 2),
                                }
                            })
    except Exception as e:
        # If parsing fails, return raw data info
        return [{"error": f"Failed to parse detections: {str(e)}", "raw_size": len(output_data) if output_data else 0}]
    
    return detections

def main():
    if len(sys.argv) < 4:
        print(json.dumps({"error": "Usage: hailo-infer.py <model_path> <input_file> <output_json>"}), file=sys.stderr)
        sys.exit(1)
    
    model_path = sys.argv[1]
    input_file = sys.argv[2]
    output_json = sys.argv[3]
    
    try:
        # Open device
        device = Device()
        
        # Load HEF model
        hef = HEF(model_path)
        network_group = device.configure(hef)
        
        # Create input/output vstreams
        with network_group.activate() as activated_network_group:
            input_vstreams_params = network_group.make_input_vstream_params()
            output_vstreams_params = network_group.make_output_vstream_params()
            
            input_vstreams = InferVStreams(activated_network_group, input_vstreams_params)
            output_vstreams = InferVStreams(activated_network_group, output_vstreams_params)
            
            # Read input data
            with open(input_file, 'rb') as f:
                input_data = f.read()
            
            # Run inference
            input_vstreams[0].send(input_data)
            output_data = output_vstreams[0].recv()
            
            # Parse detections
            detections = parse_detections(output_data)
            
            # COCO class names (first 80 classes)
            coco_classes = [
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
            ]
            
            # Add class names to detections
            for det in detections:
                if 'class_id' in det and det['class_id'] < len(coco_classes):
                    det['class_name'] = coco_classes[det['class_id']]
            
            result = {
                "detections": detections,
                "count": len(detections),
                "model": Path(model_path).name,
            }
            
            # Write output
            with open(output_json, 'w') as f:
                json.dump(result, f, indent=2)
            
            print(json.dumps({"success": True, "detections": len(detections)}))
            
    except Exception as e:
        error_result = {"error": str(e), "type": type(e).__name__}
        print(json.dumps(error_result), file=sys.stderr)
        sys.exit(1)

if __name__ == '__main__':
    main()
