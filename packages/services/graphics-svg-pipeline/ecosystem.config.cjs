const path = require('path');
const pkgDir = path.resolve(__dirname);

module.exports = {
  apps: [
    {
      name: 'graphics-svg-pipeline',
      script: 'dist/server.js',
      cwd: pkgDir,
      interpreter: 'node',
      env: { NODE_ENV: 'production' },
      kill_timeout: 15000,
      wait_ready: true,
      shutdown_with_message: true,
      autorestart: true,
      max_restarts: 5,
      restart_delay: 5000,
    },
    {
      name: 'graphics-svg-pipeline-dev',
      script: 'npx',
      args: 'shadow-cljs watch server-dev',
      cwd: pkgDir,
      env: { NODE_ENV: 'development' },
      autorestart: false,
    }
  ]
};
