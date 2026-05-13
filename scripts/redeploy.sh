#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/pickasticka}"
SERVICE_NAME="${SERVICE_NAME:-pickasticka}"

cd "$APP_DIR"

git pull --ff-only
npm ci --omit=dev

sudo systemctl daemon-reload
sudo systemctl restart "$SERVICE_NAME"
sudo systemctl --no-pager --full status "$SERVICE_NAME"
