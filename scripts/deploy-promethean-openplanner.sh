#!/usr/bin/env bash
set -euo pipefail
: "${PROMETHEAN_SSH_HOST:?PROMETHEAN_SSH_HOST is required}"
: "${PROMETHEAN_SSH_USER:=error}"
: "${PROMETHEAN_SSH_KEY_PATH:?PROMETHEAN_SSH_KEY_PATH is required}"
: "${OPENPLANNER_REMOTE_SOURCE_PATH:?OPENPLANNER_REMOTE_SOURCE_PATH is required}"
: "${OPENPLANNER_PM2_NAME:?OPENPLANNER_PM2_NAME is required}"
: "${OPENPLANNER_HEALTH_URL:?OPENPLANNER_HEALTH_URL is required}"
: "${OPENPLANNER_PORT:?OPENPLANNER_PORT is required}"
: "${DEPLOY_ENV:?DEPLOY_ENV is required}"
rsync -az --delete \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude 'dist' \
  -e "ssh -i ${PROMETHEAN_SSH_KEY_PATH}" \
  ./ "${PROMETHEAN_SSH_USER}@${PROMETHEAN_SSH_HOST}:${OPENPLANNER_REMOTE_SOURCE_PATH}/"
ssh -i "${PROMETHEAN_SSH_KEY_PATH}" "${PROMETHEAN_SSH_USER}@${PROMETHEAN_SSH_HOST}" \
  DEPLOY_ENV="$DEPLOY_ENV" \
  OPENPLANNER_REMOTE_SOURCE_PATH="$OPENPLANNER_REMOTE_SOURCE_PATH" \
  OPENPLANNER_PM2_NAME="$OPENPLANNER_PM2_NAME" \
  OPENPLANNER_HEALTH_URL="$OPENPLANNER_HEALTH_URL" \
  OPENPLANNER_PORT="$OPENPLANNER_PORT" \
  'bash -s' <<'REMOTE'
set -euo pipefail
export PATH=/usr/local/bin:$HOME/.local/bin:$PATH
cd "$OPENPLANNER_REMOTE_SOURCE_PATH"
pnpm install --frozen-lockfile
pnpm run build
SERVICE_ENV="$HOME/devel/services/openplanner/.env.${DEPLOY_ENV}"
if [ "$DEPLOY_ENV" = production ]; then
  if ~/.local/bin/pm2 describe "$OPENPLANNER_PM2_NAME" >/dev/null 2>&1; then
    ~/.local/bin/pm2 restart "$OPENPLANNER_PM2_NAME" --update-env
  else
    OPENPLANNER_PORT="$OPENPLANNER_PORT" ~/.local/bin/pm2 start dist/main.js --name "$OPENPLANNER_PM2_NAME" --no-autorestart
  fi
else
  mkdir -p "$(dirname "$SERVICE_ENV")" "$HOME/devel/services/openplanner/cloud/openplanner-lake-${DEPLOY_ENV}"
  if [ ! -f "$SERVICE_ENV" ]; then
    printf 'OPENPLANNER_API_KEY=openplanner-%s-%s\n' "$DEPLOY_ENV" "$(openssl rand -base64 32 | tr -dc A-Za-z0-9_- | head -c 32)" > "$SERVICE_ENV"
  fi
  key=$(grep -E '^OPENPLANNER_API_KEY=' "$SERVICE_ENV" | tail -1 | cut -d= -f2-)
  OPENPLANNER_API_KEY="$key" \
  OPENPLANNER_PORT="$OPENPLANNER_PORT" \
  OPENPLANNER_HOST=0.0.0.0 \
  OPENPLANNER_DATA_DIR="$HOME/devel/services/openplanner/cloud/openplanner-lake-${DEPLOY_ENV}" \
  OPENPLANNER_STORAGE_BACKEND=mongodb \
  MONGODB_URI="mongodb://127.0.0.1:27017/openplanner_${DEPLOY_ENV}" \
  MONGODB_DB="openplanner_${DEPLOY_ENV}" \
  NODE_ENV=production \
  ~/.local/bin/pm2 start dist/main.js --name "$OPENPLANNER_PM2_NAME" --update-env --no-autorestart || \
  OPENPLANNER_API_KEY="$key" OPENPLANNER_PORT="$OPENPLANNER_PORT" ~/.local/bin/pm2 restart "$OPENPLANNER_PM2_NAME" --update-env
fi
sleep 10
pid=$(~/.local/bin/pm2 jlist | node -e 'let data=""; process.stdin.on("data",d=>data+=d); process.stdin.on("end",()=>{const name=process.env.OPENPLANNER_PM2_NAME; const p=JSON.parse(data).find(x=>x.name===name); if(!p) process.exit(1); console.log(p.pid);});')
key=$(tr '\0' '\n' < "/proc/${pid}/environ" | awk -F= '$1=="OPENPLANNER_API_KEY"{print substr($0,index($0,"=")+1); exit}')
curl -fsS -H "Authorization: Bearer ${key}" "$OPENPLANNER_HEALTH_URL" >/tmp/openplanner-health.json
REMOTE
