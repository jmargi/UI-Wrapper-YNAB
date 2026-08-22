#!/bin/bash
# Portable launcher — works from wherever the repo lives.
cd "$(dirname "$0")"

if ! command -v pm2 >/dev/null 2>&1; then
  echo "❌  pm2 not found. Run ./setup.sh first."
  exit 1
fi

# Restart cleanly
pm2 delete ynab-backend ynab-frontend 2>/dev/null
pm2 start ecosystem.config.cjs

echo ""
echo "✅  YNAB Dashboard is running"
echo "   Frontend: http://localhost:5173"
echo "   Backend:  http://localhost:3001"
echo ""
echo "   pm2 logs        — view logs"
echo "   pm2 stop all    — stop everything"
echo "   pm2 restart all — restart after code changes"
