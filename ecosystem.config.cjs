/**
 * PM2 process file (EC2 / Linux). Start from repo root:
 *   pm2 start ecosystem.config.cjs
 * Set secrets via environment or `pm2 start ... --update-env` after exporting vars.
 */
module.exports = {
  apps: [
    {
      name: 'novatrix-web',
      cwd: './apps/web',
      script: 'npm',
      args: 'run start',
      instances: 1,
      autorestart: true,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'novatrix-worker',
      cwd: './apps/web',
      script: 'scripts/worker.mjs',
      interpreter: 'node',
      instances: 1,
      autorestart: true,
      /** Omit or disable this app if REDIS_URL is not set. */
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
