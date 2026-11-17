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
      // Builds then serves the static bundle (vite preview reuses server.proxy
      // and allowedHosts from vite.config.js). See frontend/serve.sh.
      script: 'serve.sh',
      interpreter: 'bash',
      max_memory_restart: '300M',
      cwd: path.join(__dirname, 'frontend'),
      watch: false,
      env: { NODE_ENV: 'development' },
      autorestart: true,
      restart_delay: 2000,
    },
  ],
};
