#!/bin/bash
set -e

# ─────────────────────────────────────────────────────────────────────────────
# YNAB Dashboard — system dependencies for Ubuntu / Debian
# Installs: build toolchain, Node.js 20 (NodeSource), pm2, and optionally Ollama.
# Usage:  ./scripts/install-deps-ubuntu.sh [--no-ollama]
# ─────────────────────────────────────────────────────────────────────────────

INSTALL_OLLAMA=1
[ "$1" = "--no-ollama" ] && INSTALL_OLLAMA=0

SUDO=""
[ "$(id -u)" -ne 0 ] && SUDO="sudo"

echo "📦  Installing build toolchain (needed for better-sqlite3)…"
$SUDO apt-get update
$SUDO apt-get install -y ca-certificates curl git build-essential python3

NODE_MAJOR=$(command -v node >/dev/null 2>&1 && node -p "process.versions.node.split('.')[0]" || echo 0)
if [ "$NODE_MAJOR" != "20" ]; then
  echo "📦  Installing Node.js 20 from NodeSource…"
  curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO -E bash -
  $SUDO apt-get install -y nodejs
else
  echo "✓   Node.js 20 already installed"
fi

if ! command -v pm2 >/dev/null 2>&1; then
  echo "📦  Installing pm2…"
  $SUDO npm install -g pm2
fi

if [ "$INSTALL_OLLAMA" = "1" ] && ! command -v ollama >/dev/null 2>&1; then
  echo "📦  Installing Ollama (local LLM for Marie AI)…"
  curl -fsSL https://ollama.com/install.sh | sh
fi

echo "✅  System dependencies installed."
