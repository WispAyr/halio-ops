# Obtaining Halio AI HAT Models

## Overview
Halio AI HAT models (`.hbm` files) are provided by the Halio SDK vendor. They are not publicly available for download and must be obtained through the official SDK installation.

## Steps to Get Models

### 1. Install Halio SDK
Follow the vendor's installation instructions to install the Halio SDK, which includes:
- `halctl` command-line tool
- Device drivers
- Model files (typically in SDK installation directory)

### 2. Locate Models
After SDK installation, models are usually located in:
- SDK installation directory (check vendor documentation)
- Use `halctl model list --json` to see available models
- Common locations:
  - `/opt/halio-sdk/models/`
  - `/usr/local/halio/models/`
  - SDK package directory

### 3. Copy Model to Expected Location
```bash
# Create model directory
sudo mkdir -p /opt/halio/models
sudo chown $USER:$USER /opt/halio/models

# Copy model from SDK location
cp /path/to/sdk/models/detect.hbm /opt/halio/models/detect.hbm
```

### 4. Verify Model
```bash
# Check model exists
ls -lh /opt/halio/models/detect.hbm

# Test inference (if halctl is available)
halctl infer --model /opt/halio/models/detect.hbm --input /path/to/segment.ts --output /tmp/test.json
```

## Using the Helper Script
Run the provided script to help locate models:
```bash
./scripts/get-halio-model.sh
```

## Note
If you don't have the Halio hardware/SDK installed, the inference system will:
- Start successfully (with warnings)
- Monitor for segments
- Skip inference when model is missing
- Automatically start processing when model becomes available
