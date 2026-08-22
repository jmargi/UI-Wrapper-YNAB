// Portable pm2 config — resolves paths relative to this file so it works
// on any machine after `git clone`. Requires `node` (v20) on PATH.
const path = require('path');

module.exports = {
  apps: [
    {
      name: 'ynab-backend',
      script: 'src/index.js',
      interpreter: 'node',
      cwd: path.join(__dirname, 'backend'),
      watch: false,
      env: { NODE_ENV: 'development' },
      autorestart: true,
      restart_delay: 2000,
    },
    {
      name: 'ynab-frontend',
      script: 'node_modules/.bin/vite',
      args: '--host 0.0.0.0',
      interpreter: 'node',
      cwd: path.join(__dirname, 'frontend'),
      watch: false,
      env: { NODE_ENV: 'development' },
      autorestart: true,
      restart_delay: 2000,
    },
  ],
};
