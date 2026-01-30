#!/usr/bin/env bash
set -euo pipefail

# Bootstrap script for Raspberry Pi 5 + Halio AI HAT operations stack

if [[ $(id -u) -ne 0 ]]; then
  echo "[bootstrap] Please run as root (sudo)." >&2
  exit 1
fi

APT_PACKAGES=(
  nginx
  ffmpeg
  gstreamer1.0-tools
  gstreamer1.0-plugins-base
  gstreamer1.0-plugins-good
  gstreamer1.0-plugins-bad
  gstreamer1.0-plugins-ugly
  gstreamer1.0-libav
)

NODE_MAJOR=20

log() {
  printf '[bootstrap] %s\n' "$*"
}

log "Updating package index"
apt-get update

log "Installing base packages: ${APT_PACKAGES[*]}"
apt-get install -y "${APT_PACKAGES[@]}"

if ! command -v node >/dev/null 2>&1 || [[ $(node -v | cut -d'.' -f1) != "v${NODE_MAJOR}" ]]; then
  log "Installing Node.js ${NODE_MAJOR} LTS via NodeSource"
  curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | bash -
  apt-get install -y nodejs
fi

log "Ensuring PCIe Gen 3 is enabled for Halio AI HAT"
if raspi-config nonint get_config_var PCIe_GEN3 /boot/firmware/config.txt | grep -qi '1'; then
  log "PCIe Gen 3 already enabled."
else
  raspi-config nonint set_pcie_gen3 1
  log "PCIe Gen 3 enabled. Reboot required to take effect."
fi

log "Installing halctl if available"
if ! command -v halctl >/dev/null 2>&1; then
  log "halctl not found; refer to docs/halio-ai-setup.md for manual installation instructions."
else
  log "halctl already installed."
fi

log "Done."
