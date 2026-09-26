#!/bin/bash
set -e
cd "$(dirname "$0")"

# ─────────────────────────────────────────────────────────────────────────────
# YNAB Dashboard — one-time setup for macOS (Homebrew) or Ubuntu/Debian
# ─────────────────────────────────────────────────────────────────────────────

echo "🔧  Setting up YNAB Dashboard…"

# 1. System dependencies (Node 20, build tools, Ollama)
case "$(uname -s)" in
  Darwin)
    if ! command -v brew >/dev/null 2>&1; then
      echo "❌  Homebrew not found. Install it from https://brew.sh and re-run."
      exit 1
    fi
    if ! xcode-select -p >/dev/null 2>&1; then
      echo "❌  Xcode Command Line Tools missing. Run:  xcode-select --install"
      exit 1
    fi
    echo "📦  Installing Homebrew dependencies (Brewfile)…"
    brew bundle --file=Brewfile
    # node@20 is keg-only — put it ahead of any newer default node.
    export PATH="$(brew --prefix node@20)/bin:$PATH"
    ;;
  Linux)
    if command -v apt-get >/dev/null 2>&1; then
      ./scripts/install-deps-ubuntu.sh
    else
      echo "⚠️   Non-apt Linux: install Node 20, build tools (gcc, make, python3) and pm2 yourself."
    fi
    ;;
esac

# 2. Verify Node 20
if ! command -v node >/dev/null 2>&1; then
  echo "❌  Node.js not found."
  exit 1
fi
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" != "20" ]; then
  echo "⚠️   Using Node $NODE_MAJOR from $(command -v node). This app needs Node 20;"
  echo "    better-sqlite3 will likely fail to build on other versions."
fi

# 3. Create .env from template if missing
if [ ! -f backend/.env ]; then
  cp backend/.env.example backend/.env
  echo "📝  Created backend/.env — add your YNAB_API_KEY"
fi

# 4. Install npm dependencies
echo "📦  Installing backend dependencies…"
( cd backend && npm install )

echo "📦  Installing frontend dependencies…"
( cd frontend && npm install )

# 5. Install pm2 globally if missing
if ! command -v pm2 >/dev/null 2>&1; then
  echo "📦  Installing pm2 (process manager)…"
  npm install -g pm2
fi

echo ""
echo "✅  Setup complete!"
echo ""
echo "   1. Edit backend/.env and add your YNAB_API_KEY"
echo "   2. For Marie AI:  ollama pull qwen2.5:14b"
echo "   3. Run ./start.sh to launch the app"
echo "   4. Open http://localhost:5173"
