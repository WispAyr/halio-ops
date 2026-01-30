#!/usr/bin/env bash
set -euo pipefail

# Script to help obtain Halio AI HAT model files
# Models are typically provided by the Halio SDK vendor

MODEL_DIR="/opt/halio/models"
MODEL_NAME="detect.hbm"

log() {
  printf '[get-model] %s\n' "$*"
}

log "Checking for Halio SDK and models..."

# Check if halctl is available
if command -v halctl >/dev/null 2>&1; then
  log "halctl found, checking for installed models..."
  if halctl model list --json 2>/dev/null | grep -q "\.hbm"; then
    log "Models found via halctl. Use 'halctl model list --json' to see available models."
    log "To export a model, check halctl documentation for model export commands."
  else
    log "No models found via halctl."
  fi
else
  log "halctl not found. Please install Halio SDK first."
  log "Refer to docs/halio-ai-setup.md for installation instructions."
fi

# Check if model directory exists
if [[ ! -d "$MODEL_DIR" ]]; then
  log "Creating model directory: $MODEL_DIR"
  sudo mkdir -p "$MODEL_DIR"
  sudo chown $USER:$USER "$MODEL_DIR"
fi

# Check if model already exists
if [[ -f "$MODEL_DIR/$MODEL_NAME" ]]; then
  log "Model already exists: $MODEL_DIR/$MODEL_NAME"
  exit 0
fi

log ""
log "Model file not found: $MODEL_DIR/$MODEL_NAME"
log ""
log "To obtain Halio models:"
log "1. Install Halio SDK from vendor"
log "2. Use halctl to list/export models: halctl model list"
log "3. Or copy model files from SDK installation directory"
log "4. Place .hbm files in: $MODEL_DIR"
log ""
log "Common SDK installation locations:"
log "  - /opt/halio-sdk/"
log "  - /usr/local/halio/"
log "  - ~/halio-sdk/"
log ""

# Check common SDK locations
for sdk_path in /opt/halio-sdk /usr/local/halio ~/halio-sdk; do
  if [[ -d "$sdk_path" ]]; then
    log "Found potential SDK at: $sdk_path"
    if find "$sdk_path" -name "*.hbm" -type f 2>/dev/null | head -1; then
      MODEL_FOUND=$(find "$sdk_path" -name "*.hbm" -type f 2>/dev/null | head -1)
      log "Found model: $MODEL_FOUND"
      read -p "Copy this model to $MODEL_DIR/$MODEL_NAME? (y/n) " -n 1 -r
      echo
      if [[ $REPLY =~ ^[Yy]$ ]]; then
        cp "$MODEL_FOUND" "$MODEL_DIR/$MODEL_NAME"
        log "Model copied successfully!"
        exit 0
      fi
    fi
  fi
done

log "No models found. Please install Halio SDK and models manually."
exit 1
