module.exports = {
  apps: [
    {
      name: 'bizflow-api',
      script: 'backend/dist/server.js',
      cwd: __dirname,
      instances: 2,
      exec_mode: 'cluster',
      env_production: { NODE_ENV: 'production', PORT: 5000 },
    },
    {
      name: 'bizflow-worker',
      script: 'backend/dist/worker.js',
      cwd: __dirname,
      instances: 1,
      env_production: { NODE_ENV: 'production' },
    },
  ],
};
