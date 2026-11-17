#!/bin/bash
# Production frontend for pm2: build, then serve the static bundle.
# Replaces the always-on Vite dev server (unbundled modules, React dev mode,
# file watchers) — much lighter on the laptop and much snappier on the phone.
# `pm2 restart ynab-frontend` rebuilds, so code changes still go live with one
# command. For hot-reload while actively developing, use `npm run dev` instead.
set -e
cd "$(dirname "$0")"
node_modules/.bin/vite build
exec node_modules/.bin/vite preview --host 0.0.0.0 --port 5173 --strictPort
