#!/bin/bash
set -euo pipefail
git pull origin main
cd backend && npm ci && npm run build && npm run migrate
cd ../frontend && npm ci && npm run build
WEB_ROOT="${WEB_ROOT:-/var/www/microtechnique-accounts}"
sudo mkdir -p "$WEB_ROOT"
sudo cp -r dist/* "$WEB_ROOT/"
cd ..
pm2 reload ecosystem.config.js --env production
echo "Deploy complete"
