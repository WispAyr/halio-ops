const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const analyzeService = require('../services/analyzeService');

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(os.tmpdir(), 'halio-uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

router.post('/', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  
  try {
    const result = await analyzeService.analyzeImage(req.file.path, { model: req.body.model });
    fs.unlink(req.file.path, () => {});
    res.json(result);
  } catch (err) {
    if (req.file) fs.unlink(req.file.path, () => {});
    res.status(500).json({ error: err.message });
  }
});

router.post('/base64', async (req, res) => {
  const { image, model } = req.body;
  if (!image) return res.status(400).json({ error: 'Base64 image required' });
  
  try {
    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    const tmpFile = path.join(os.tmpdir(), 'hailo-' + Date.now() + '.jpg');
    fs.writeFileSync(tmpFile, buffer);
    
    const result = await analyzeService.analyzeImage(tmpFile, { model });
    fs.unlink(tmpFile, () => {});
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/models', (req, res) => {
  res.json({
    models: [
      { id: 'yolov5s_personface', name: 'Person & Face Detection', path: '/usr/share/hailo-models/yolov5s_personface_h8l.hef' },
      { id: 'yolov8s', name: 'General Object Detection', path: '/usr/share/hailo-models/yolov8s_h8l.hef' },
      { id: 'yolov6n', name: 'Fast Detection', path: '/usr/share/hailo-models/yolov6n_h8l.hef' }
    ]
  });
});

module.exports = router;
