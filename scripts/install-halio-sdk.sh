#!/usr/bin/env bash
set -euo pipefail

# Comprehensive Halio SDK installation script
# This script automates everything possible without vendor SDK files

MODEL_DIR="/opt/halio/models"
SDK_DIR="/opt/halio-sdk"
VENDOR_DIR="/home/pi/live/halio-ops/vendor"

log() {
  printf '[install-sdk] %s\n' "$*"
}

log "=== Halio SDK Installation Helper ==="
log ""

# Check if running as root for system changes
if [[ $(id -u) -ne 0 ]]; then
  log "Some operations require sudo. You may be prompted for password."
fi

# Step 1: Enable PCIe Gen 3
log "Step 1: Configuring PCIe Gen 3..."
if sudo raspi-config nonint set_pcie_gen3 1; then
  log "✓ PCIe Gen 3 enabled (reboot required to take effect)"
else
  log "⚠ Could not enable PCIe Gen 3 (may already be enabled)"
fi

# Step 2: Create directories
log ""
log "Step 2: Creating directories..."
sudo mkdir -p "$MODEL_DIR"
sudo mkdir -p "$SDK_DIR"
sudo mkdir -p "$VENDOR_DIR"
sudo chown -R $USER:$USER "$MODEL_DIR" "$SDK_DIR" "$VENDOR_DIR"
log "✓ Directories created"

# Step 3: Check for existing SDK installers
log ""
log "Step 3: Checking for SDK installers..."
INSTALLER_FOUND=false

# Check vendor directory
if [[ -d "$VENDOR_DIR" ]]; then
  shopt -s nullglob
  for installer in "$VENDOR_DIR"/*.deb "$VENDOR_DIR"/*.sh "$VENDOR_DIR"/*.tar.gz "$VENDOR_DIR"/*.zip; do
    if [[ -f "$installer" ]]; then
      log "Found installer: $installer"
      INSTALLER_FOUND=true
    fi
  done
  shopt -u nullglob
fi

# Check common download locations
for loc in ~/Downloads ~/downloads ~/Desktop; do
  if [[ -d "$loc" ]]; then
    shopt -s nullglob
    for installer in "$loc"/*halio*.deb "$loc"/*halio*.sh "$loc"/*halio*.tar.gz "$loc"/*halio*.zip; do
      if [[ -f "$installer" ]]; then
        log "Found installer: $installer"
        INSTALLER_FOUND=true
        read -p "Copy to vendor directory? (y/n) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
          cp "$installer" "$VENDOR_DIR/"
          log "✓ Copied to vendor directory"
        fi
      fi
    done
    shopt -u nullglob
  fi
done

if [[ "$INSTALLER_FOUND" == "false" ]]; then
  log "⚠ No SDK installer found"
  log ""
  log "To install SDK:"
  log "1. Download SDK from vendor"
  log "2. Place installer in: $VENDOR_DIR"
  log "3. Run this script again"
fi

# Step 4: Install from found installer
if [[ "$INSTALLER_FOUND" == "true" ]]; then
  log ""
  log "Step 4: Installing SDK..."
  shopt -s nullglob
  for installer in "$VENDOR_DIR"/*.deb "$VENDOR_DIR"/*.sh "$VENDOR_DIR"/*.tar.gz "$VENDOR_DIR"/*.zip; do
    if [[ -f "$installer" ]]; then
      log "Installing: $installer"
      case "$installer" in
        *.deb)
          sudo dpkg -i "$installer" || sudo apt-get install -f -y
          ;;
        *.sh)
          chmod +x "$installer"
          sudo "$installer"
          ;;
        *.tar.gz|*.zip)
          log "Extracting to $SDK_DIR..."
          cd "$SDK_DIR"
          if [[ "$installer" == *.tar.gz ]]; then
            tar -xzf "$installer"
          else
            unzip "$installer"
          fi
          log "✓ Extracted. Check for install script in extracted files."
          ;;
      esac
    fi
  done
  shopt -u nullglob
fi

# Step 5: Verify halctl installation
log ""
log "Step 5: Verifying installation..."
if command -v halctl >/dev/null 2>&1; then
  log "✓ halctl found: $(which halctl)"
  halctl --version 2>/dev/null || log "⚠ Could not get version"
  
  # Check for models
  if halctl model list --json 2>/dev/null; then
    log "✓ Models available via halctl"
    log "Listing models..."
    halctl model list --json | head -20
  else
    log "⚠ No models found via halctl"
  fi
else
  log "⚠ halctl not found in PATH"
  log "  SDK may need to be installed or PATH updated"
fi

# Step 6: Check for device
log ""
log "Step 6: Checking for Halio device..."
if lspci | grep -qi halio; then
  log "✓ Halio device detected via lspci"
  lspci | grep -i halio
else
  log "⚠ Halio device not detected"
  log "  - Ensure hardware is connected"
  log "  - Check PCIe ribbon cable"
  log "  - Reboot may be required after PCIe Gen 3 enable"
fi

if ls /dev/halio* 2>/dev/null; then
  log "✓ Halio device files found:"
  ls -la /dev/halio*
else
  log "⚠ No /dev/halio device files"
fi

# Step 7: Locate and copy models
log ""
log "Step 7: Locating models..."
if command -v halctl >/dev/null 2>&1; then
  MODEL_LIST=$(halctl model list --json 2>/dev/null || echo "[]")
  if [[ "$MODEL_LIST" != "[]" && "$MODEL_LIST" != "" ]]; then
    log "Models found via halctl"
    # Try to find model files
    for sdk_path in /opt/halio-sdk /usr/local/halio ~/halio-sdk "$SDK_DIR"; do
      if [[ -d "$sdk_path" ]]; then
        MODEL_FILE=$(find "$sdk_path" -name "*.hbm" -type f 2>/dev/null | head -1)
        if [[ -n "$MODEL_FILE" ]]; then
          log "Found model: $MODEL_FILE"
          read -p "Copy to $MODEL_DIR/detect.hbm? (y/n) " -n 1 -r
          echo
          if [[ $REPLY =~ ^[Yy]$ ]]; then
            cp "$MODEL_FILE" "$MODEL_DIR/detect.hbm"
            chmod 644 "$MODEL_DIR/detect.hbm"
            log "✓ Model copied successfully!"
          fi
        fi
      fi
    done
  fi
fi

# Step 8: Final status
log ""
log "=== Installation Status ==="
log "halctl: $(command -v halctl 2>/dev/null || echo 'NOT FOUND')"
log "Device: $(lspci | grep -i halio || echo 'NOT DETECTED')"
log "Model: $(ls -lh $MODEL_DIR/detect.hbm 2>/dev/null | awk '{print $5, $9}' || echo 'NOT FOUND')"
log ""
log "Next steps:"
if ! command -v halctl >/dev/null 2>&1; then
  log "1. Install Halio SDK from vendor"
fi
if [[ ! -f "$MODEL_DIR/detect.hbm" ]] || [[ ! -s "$MODEL_DIR/detect.hbm" ]]; then
  log "2. Copy model file to $MODEL_DIR/detect.hbm"
fi
if ! lspci | grep -qi halio; then
  log "3. Connect Halio hardware and reboot"
fi
log "4. Restart halio-ops service"
log ""
log "Done!"
