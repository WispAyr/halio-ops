#!/usr/bin/env python3
"""
Extract detection results from Hailo inference.
This script runs inference and extracts bounding boxes, classes, and confidence scores.
"""
import sys
import json
import numpy as np
from pathlib import Path

try:
    from hailo_platform import Device, HEF
except ImportError as e:
    print(json.dumps({"error": f"Hailo Python API not available: {e}"}), file=sys.stderr)
    sys.exit(1)

# COCO class names (80 classes for YOLOv8)
COCO_CLASSES = [
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

def parse_nms_output(output_data, num_classes=80, max_boxes_per_class=100, score_threshold=0.2):
    """
    Parse YOLOv8 NMS output format.
    Output format: [num_classes, max_boxes_per_class, 6]
    Where 6 = [x_center, y_center, width, height, confidence, class_id]
    """
    detections = []
    
    if output_data is None or len(output_data) == 0:
        return detections
    
    try:
        # Convert to numpy array
        data = np.frombuffer(output_data, dtype=np.float32)
        
        # Expected size: num_classes * max_boxes_per_class * 6
        expected_size = num_classes * max_boxes_per_class * 6
        
        if len(data) < expected_size:
            # Try to pad or truncate
            if len(data) > 0:
                # Reshape what we have
                actual_boxes = len(data) // 6
                if actual_boxes > 0:
                    data = data[:actual_boxes * 6].reshape(actual_boxes, 6)
                    # Process as flat list
                    for box in data:
                        if len(box) >= 6:
                            x_center, y_center, width, height, confidence, class_id = box[:6]
                            if confidence > score_threshold:
                                class_id_int = int(class_id)
                                detections.append({
                                    "class_id": class_id_int,
                                    "class_name": COCO_CLASSES[class_id_int] if 0 <= class_id_int < len(COCO_CLASSES) else f"class_{class_id_int}",
                                    "confidence": float(confidence),
                                    "bbox": {
                                        "x_center": float(x_center),
                                        "y_center": float(y_center),
                                        "width": float(width),
                                        "height": float(height),
                                        "x1": float(max(0, x_center - width / 2)),
                                        "y1": float(max(0, y_center - height / 2)),
                                        "x2": float(min(640, x_center + width / 2)),
                                        "y2": float(min(640, y_center + height / 2)),
                                    }
                                })
        else:
            # Reshape to expected format
            data = data[:expected_size].reshape(num_classes, max_boxes_per_class, 6)
            
            for class_id in range(num_classes):
                for box_idx in range(max_boxes_per_class):
                    box = data[class_id, box_idx]
                    x_center, y_center, width, height, confidence, detected_class = box
                    
                    if confidence > score_threshold:
                        class_id_int = int(detected_class)
                        detections.append({
                            "class_id": class_id_int,
                            "class_name": COCO_CLASSES[class_id_int] if 0 <= class_id_int < len(COCO_CLASSES) else f"class_{class_id_int}",
                            "confidence": float(confidence),
                            "bbox": {
                                "x_center": float(x_center),
                                "y_center": float(y_center),
                                "width": float(width),
                                "height": float(height),
                                "x1": float(max(0, x_center - width / 2)),
                                "y1": float(max(0, y_center - height / 2)),
                                "x2": float(min(640, x_center + width / 2)),
                                "y2": float(min(640, y_center + height / 2)),
                            }
                        })
    except Exception as e:
        return [{"error": f"Failed to parse detections: {str(e)}", "raw_size": len(output_data) if output_data else 0}]
    
    return detections

def main():
    if len(sys.argv) < 4:
        print(json.dumps({"error": "Usage: get-detections.py <model_path> <input_file> <output_json>"}), file=sys.stderr)
        sys.exit(1)
    
    model_path = sys.argv[1]
    input_file = sys.argv[2]
    output_json = sys.argv[3]
    
    try:
        # Read input data
        with open(input_file, 'rb') as f:
            input_data = f.read()
        
        # Load HEF model
        hef = HEF(model_path)
        
        # Try to get device - use PcieDevice if available, otherwise try Device
        try:
            from hailo_platform import PcieDevice
            device = PcieDevice()
        except (ImportError, AttributeError):
            # Fallback: try to create device directly
            try:
                device = Device()
            except Exception as e:
                print(json.dumps({"error": f"Failed to create device: {e}"}), file=sys.stderr)
                sys.exit(1)
        
        # Configure network group
        network_group = device.configure(hef)
        
        # Get input/output vstream info
        input_vstream_infos, output_vstream_infos = network_group.make_input_vstream_params(), network_group.make_output_vstream_params()
        
        # Activate network group
        with network_group.activate() as activated_network_group:
            # Create vstreams
            from hailo_platform import InferVStreams
            
            input_vstreams = InferVStreams(activated_network_group, input_vstream_infos)
            output_vstreams = InferVStreams(activated_network_group, output_vstream_infos)
            
            # Run inference
            input_vstreams[0].send(input_data)
            output_data = output_vstreams[0].recv()
            
            # Parse detections
            detections = parse_nms_output(output_data)
            
            # Group by class for summary
            class_counts = {}
            for det in detections:
                class_name = det.get('class_name', 'unknown')
                class_counts[class_name] = class_counts.get(class_name, 0) + 1
            
            result = {
                "detections": detections,
                "count": len(detections),
                "summary": class_counts,
                "model": Path(model_path).name,
                "success": True
            }
            
            # Write output
            with open(output_json, 'w') as f:
                json.dump(result, f, indent=2)
            
            print(json.dumps({"success": True, "detections": len(detections), "summary": class_counts}))
            
    except Exception as e:
        import traceback
        error_result = {
            "error": str(e),
            "type": type(e).__name__,
            "traceback": traceback.format_exc()
        }
        print(json.dumps(error_result), file=sys.stderr)
        sys.exit(1)

if __name__ == '__main__':
    main()
