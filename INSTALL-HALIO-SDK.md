# Installing Halio SDK and Models

## Current Status
✅ Model directory created: `/opt/halio/models/`
✅ Placeholder file exists: `/opt/halio/models/detect.hbm`
✅ System configured and ready
❌ Halio SDK not installed (halctl not found)
❌ Halio hardware not detected

## Required Steps

### Step 1: Obtain Halio SDK
The Halio SDK is provided by the vendor and typically includes:
- Installation package/installer
- `halctl` command-line tool
- Device drivers
- Model files (`.hbm` format)

**Action Required:** Contact Halio vendor or check vendor documentation for:
- SDK download location
- Installation instructions
- License requirements

### Step 2: Install Halio SDK
Follow vendor's installation instructions. Common installation methods:
```bash
# Example (vendor-specific):
sudo ./halio-sdk-installer.sh
# or
sudo dpkg -i halio-sdk.deb
# or
sudo apt install halio-sdk  # if available in vendor repo
```

### Step 3: Verify Installation
```bash
# Check halctl is available
which halctl
halctl --version

# Check device is detected
lspci | grep -i halio
ls -la /dev/halio*

# List available models
halctl model list --json
```

### Step 4: Copy Model File
Once SDK is installed and models are available:
```bash
# Find model location (check SDK docs)
halctl model list --json

# Copy model to expected location
sudo cp /path/to/sdk/models/detect.hbm /opt/halio/models/detect.hbm
sudo chown $USER:$USER /opt/halio/models/detect.hbm

# Verify
ls -lh /opt/halio/models/detect.hbm
```

### Step 5: Test Inference
```bash
# Test with a segment from your pipeline
halctl infer \
  --model /opt/halio/models/detect.hbm \
  --input /home/pi/live/halio-ops/pipelines/output/car-park/segment-00000.ts \
  --output /tmp/test-inference.json

# Check result
cat /tmp/test-inference.json
```

### Step 6: Restart Pipeline Service
The system will automatically detect the model and start processing:
```bash
# Restart the service
pkill -f "node src/server.js"
cd /home/pi/live/halio-ops
npm start
```

## Helper Script
Use the provided script to help locate models after SDK installation:
```bash
./scripts/get-halio-model.sh
```

## Current System Status
The inference watcher is **ready and waiting**. It will:
- ✅ Start monitoring for segments
- ✅ Detect when model file becomes available
- ✅ Automatically begin inference processing
- ✅ Log all activity via WebSocket

## Next Actions
1. **Obtain Halio SDK** from vendor
2. **Install SDK** following vendor instructions
3. **Copy model file** to `/opt/halio/models/detect.hbm`
4. **System will automatically start processing** - no restart needed for model detection

## Verification Commands
```bash
# Check SDK installation
halctl status

# Check model availability
ls -lh /opt/halio/models/detect.hbm

# Check API status
curl http://localhost:3000/halio/status

# Check pipeline inference status
curl http://localhost:3000/pipelines
```
