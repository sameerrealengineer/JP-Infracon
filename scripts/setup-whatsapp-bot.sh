#!/usr/bin/env bash
# Turns on the 24-hour WhatsApp bot on the Azure server (run after setup-openwa.sh):
#   bash scripts/setup-whatsapp-bot.sh          (turn on)
#   bash scripts/setup-whatsapp-bot.sh off      (turn off; the webhook stays but is refused)
# 1. Makes a random webhook secret on the server (never printed) and saves it in deploy/.env.
# 2. Registers https://$DOMAIN/api/whatsapp/webhook with OpenWA for message.received, signed.
# 3. Sets WHATSAPP_BOT=on and restarts OpenWA and the API.
# The bot answers only staff whose mobile is saved in their JP Infracon alert settings.
set -euo pipefail

HOST="${JP_DEPLOY_HOST:-jpadmin@jpinfracon.centralindia.cloudapp.azure.com}"
MODE="${1:-on}"

ssh "$HOST" "MODE=$MODE bash -s" <<'REMOTE'
set -euo pipefail
cd ~/jp-infracon/deploy
set_env() {
  if grep -qE "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else printf '%s=%s\n' "$1" "$2" >> .env; fi
}
if [ "$MODE" = "off" ]; then
  set_env WHATSAPP_BOT off
  docker compose --env-file .env up -d api </dev/null >/dev/null
  echo "== WhatsApp bot turned off =="
  exit 0
fi
SID="$(grep -E '^OPENWA_SESSION=' .env | cut -d= -f2- || true)"
DOMAIN="$(grep -E '^DOMAIN=' .env | cut -d= -f2- || true)"
[ -n "$SID" ] || { echo "Run scripts/setup-openwa.sh first."; exit 1; }
[ -n "$DOMAIN" ] || { echo "DOMAIN is missing in deploy/.env"; exit 1; }
SECRET="$(grep -E '^OPENWA_WEBHOOK_SECRET=' .env | cut -d= -f2- || true)"
if [ ${#SECRET} -lt 16 ]; then
  SECRET="$(openssl rand -hex 24)"
  set_env OPENWA_WEBHOOK_SECRET "$SECRET"
fi
set_env WHATSAPP_BOT on
chmod 600 .env
docker compose --env-file .env --profile openwa up -d openwa api </dev/null >/dev/null
for i in $(seq 1 60); do curl -fsS http://127.0.0.1:2785/api/health >/dev/null 2>&1 && break; sleep 3; done
KEY="$(docker compose exec -T openwa cat /app/data/.api-key </dev/null)"
URL="https://$DOMAIN/api/whatsapp/webhook"
api() { curl -fsS -H "X-API-Key: $KEY" -H "Content-Type: application/json" "$@"; }
# Remove an older registration of the same URL, then register it again with the secret.
api "http://127.0.0.1:2785/api/sessions/$SID/webhooks" | URL="$URL" python3 -c "
import json,os,sys
d=json.load(sys.stdin); d=d.get('data',d) if isinstance(d,dict) else d
print('\n'.join(w['id'] for w in d if w.get('url')==os.environ['URL']))" | while read -r id; do
  [ -n "$id" ] && api -X DELETE "http://127.0.0.1:2785/api/sessions/$SID/webhooks/$id" >/dev/null || true
done
BODY="$(URL="$URL" SECRET="$SECRET" python3 -c "import json,os; print(json.dumps({'url':os.environ['URL'],'events':['message.received'],'secret':os.environ['SECRET']}))")"
api -X POST "http://127.0.0.1:2785/api/sessions/$SID/webhooks" -d "$BODY" >/dev/null
echo "== WhatsApp bot is on: messages to the linked number now get answers (staff only) =="
REMOTE
