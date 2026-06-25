#!/bin/bash
set -euo pipefail
git pull origin main
cd backend && npm ci && npm run build && npm run migrate
cd ../frontend && npm ci && npm run build
sudo mkdir -p /var/www/bizflow
sudo cp -r dist/* /var/www/bizflow/
cd ..
pm2 reload ecosystem.config.js --env production
echo "Deploy complete"
