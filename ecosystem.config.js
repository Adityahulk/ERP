module.exports = {
  apps: [
    {
      name: 'microtechnique-accounts-api',
      script: 'backend/dist/server.js',
      cwd: __dirname,
      instances: 2,
      exec_mode: 'cluster',
      env_production: { NODE_ENV: 'production', PORT: 5000 },
    },
    {
      name: 'microtechnique-accounts-worker',
      script: 'backend/dist/worker.js',
      cwd: __dirname,
      instances: 1,
      env_production: { NODE_ENV: 'production' },
    },
  ],
};
