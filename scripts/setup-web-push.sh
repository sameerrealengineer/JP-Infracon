#!/usr/bin/env bash
# Turns on browser push (notifications for the web app on iPhone and computers).
#   bash scripts/setup-web-push.sh
# 1. On the server, creates a VAPID key pair (once) and adds WEB_PUSH_PUBLIC_KEY,
#    WEB_PUSH_PRIVATE_KEY and WEB_PUSH_SUBJECT to deploy/.env. Keys are never printed.
# 2. Restarts the API so it reads them.
# 3. Checks the API answers. Then each person turns notifications on in Alert settings.
# Running it again changes nothing once the keys exist (new keys would break every subscription).
set -euo pipefail

HOST="${JP_DEPLOY_HOST:-jpadmin@jpinfracon.centralindia.cloudapp.azure.com}"

echo "== 1/3 Keys =="
ssh "$HOST" 'set -e; cd ~/jp-infracon/deploy; \
  if grep -q "^WEB_PUSH_PRIVATE_KEY=..*" .env; then echo "keys: already set (kept)"; else \
    docker compose --env-file .env exec -T api node -e "const c=require(\"crypto\");const e=c.createECDH(\"prime256v1\");e.generateKeys();console.log(\"WEB_PUSH_PUBLIC_KEY=\"+e.getPublicKey().toString(\"base64url\"));console.log(\"WEB_PUSH_PRIVATE_KEY=\"+e.getPrivateKey().toString(\"base64url\"))" >> .env; \
    grep -q "^WEB_PUSH_SUBJECT=" .env || echo "WEB_PUSH_SUBJECT=https://$(grep "^DOMAIN=" .env | cut -d= -f2)" >> .env; \
    echo "keys: created"; fi'

echo "== 2/3 Restart the API =="
ssh "$HOST" 'cd ~/jp-infracon/deploy && docker compose --env-file .env up -d api >/dev/null && sleep 20 && \
  for k in WEB_PUSH_PUBLIC_KEY WEB_PUSH_PRIVATE_KEY WEB_PUSH_SUBJECT; do \
    if grep -q "^$k=..*" .env; then echo "$k: set"; else echo "$k: NOT set"; fi; done'

echo "== 3/3 Check =="
code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "https://${HOST#*@}/api/health" || true)
echo "API health: HTTP $code"
[ "$code" = "200" ] || { echo "API not healthy after restart" >&2; exit 1; }
echo "Done. In the app: More → Alert settings → Notifications on this browser."
