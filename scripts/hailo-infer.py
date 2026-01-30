#!/usr/bin/env python3
import sys, json
import numpy as np
from PIL import Image

try:
    from hailo_platform import VDevice, HEF, FormatType, InferVStreams, InputVStreamParams, OutputVStreamParams
except ImportError as e:
    print(json.dumps({'success': False, 'error': f'Import failed: {e}'}))
    sys.exit(1)

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

def analyze(image_path, model_path):
    try:
        img = Image.open(image_path).convert('RGB')
        orig_w, orig_h = img.size
        img_resized = img.resize((640, 640))
        img_array = np.array(img_resized, dtype=np.uint8)
        
        target = VDevice()
        hef = HEF(model_path)
        network_groups = target.configure(hef)
        network_group = network_groups[0]
        
        input_info = hef.get_input_vstream_infos()
        output_info = hef.get_output_vstream_infos()
        
        input_params = InputVStreamParams.make(network_group, format_type=FormatType.UINT8)
        output_params = OutputVStreamParams.make(network_group, format_type=FormatType.FLOAT32)
        
        detections = []
        
        with InferVStreams(network_group, input_params, output_params) as pipeline:
            input_data = {input_info[0].name: np.expand_dims(img_array, 0)}
            with network_group.activate():
                results = pipeline.infer(input_data)
                
                for out in output_info:
                    data = results[out.name]
                    
                    # Handle NMS output: list[batch][classes][detections]
                    if isinstance(data, list) and len(data) > 0:
                        batch = data[0]  # First (only) batch
                        for class_id, class_dets in enumerate(batch):
                            for det in class_dets:
                                if len(det) < 5:
                                    continue
                                x1, y1, x2, y2, conf = det[:5]
                                if conf < 0.25:
                                    continue
                                
                                class_name = COCO_CLASSES[class_id] if class_id < len(COCO_CLASSES) else f'class_{class_id}'
                                detections.append({
                                    'class': class_name,
                                    'confidence': round(float(conf), 3),
                                    'bbox': {
                                        'x': round(float(x1) * orig_w),
                                        'y': round(float(y1) * orig_h),
                                        'width': round(float(x2 - x1) * orig_w),
                                        'height': round(float(y2 - y1) * orig_h)
                                    }
                                })
        
        target.release()
        return {'success': True, 'detections': detections, 'model': model_path.split('/')[-1]}
        
    except Exception as e:
        import traceback
        return {'success': False, 'error': str(e), 'trace': traceback.format_exc()[:500]}

if __name__ == '__main__':
    if len(sys.argv) < 3:
        print(json.dumps({'success': False, 'error': 'Usage: hailo-infer.py <image> <model>'}))
        sys.exit(1)
    print(json.dumps(analyze(sys.argv[1], sys.argv[2])))
