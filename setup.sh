#!/bin/bash
set -e

# ─────────────────────────────────────────────────────────────────────────────
# YNAB Dashboard — one-time setup for macOS
# ─────────────────────────────────────────────────────────────────────────────

echo "🔧  Setting up YNAB Dashboard…"

# 1. Check for Node 20
if ! command -v node >/dev/null 2>&1; then
  echo "❌  Node.js not found. Install Node 20 with:  brew install node@20"
  echo "    then add it to your PATH and re-run this script."
  exit 1
fi

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 18 ] || [ "$NODE_MAJOR" -gt 22 ]; then
  echo "⚠️   You have Node $NODE_MAJOR. This app is tested on Node 20."
  echo "    better-sqlite3 may fail to build on newer versions."
fi

# 2. Create .env files from templates if missing
if [ ! -f backend/.env ]; then
  cp backend/.env.example backend/.env
  echo "📝  Created backend/.env — add your YNAB_API_KEY and ANTHROPIC_API_KEY"
fi

# 3. Install dependencies
echo "📦  Installing backend dependencies…"
( cd backend && npm install )

echo "📦  Installing frontend dependencies…"
( cd frontend && npm install )

# 4. Install pm2 globally if missing
if ! command -v pm2 >/dev/null 2>&1; then
  echo "📦  Installing pm2 (process manager)…"
  npm install -g pm2
fi

echo ""
echo "✅  Setup complete!"
echo ""
echo "   1. Edit backend/.env and add your API keys"
echo "   2. Run ./start.sh to launch the app"
echo "   3. Open http://localhost:5173"
