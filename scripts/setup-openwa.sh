#!/usr/bin/env bash
# Sets up WhatsApp alerts with OpenWA on the Azure server, in one go:
#   bash scripts/setup-openwa.sh 9876543210      (the WhatsApp number that will SEND alerts)
# 1. Starts the OpenWA container (profile "openwa"; dashboard bound to 127.0.0.1 only).
# 2. Creates (or reuses) the "jp-alerts" session and asks WhatsApp for a pairing code.
#    On that phone: WhatsApp → Linked devices → Link a device → Link with phone number → enter code.
# 3. When linked, writes WHATSAPP_PROVIDER/OPENWA_* into deploy/.env (the key is never printed)
#    and restarts the API.
# Use a separate business number: OpenWA is not an official WhatsApp tool and a number can be banned.
set -euo pipefail

HOST="${JP_DEPLOY_HOST:-jpadmin@jpinfracon.centralindia.cloudapp.azure.com}"
digits="$(printf '%s' "${1:-}" | tr -cd '0-9')"
if [ ${#digits} -eq 10 ]; then digits="91${digits}"; fi
if ! printf '%s' "$digits" | grep -Eq '^[0-9]{11,15}$'; then
  echo "Give the sending WhatsApp number, e.g.: bash scripts/setup-openwa.sh 9876543210" >&2
  exit 1
fi

ssh -t "$HOST" "PHONE=$digits bash -s" <<'REMOTE'
set -euo pipefail
cd ~/jp-infracon/deploy
echo "== Starting OpenWA =="
docker compose --env-file .env --profile openwa up -d openwa >/dev/null
for i in $(seq 1 60); do
  curl -fsS http://127.0.0.1:2785/api/health >/dev/null 2>&1 && break
  sleep 3
done
curl -fsS http://127.0.0.1:2785/api/health >/dev/null || { echo "OpenWA did not start"; exit 1; }
KEY="$(docker compose exec -T openwa cat /app/data/.api-key)"
api() { curl -fsS -H "X-API-Key: $KEY" -H "Content-Type: application/json" "$@"; }
json() { python3 -c "import json,sys; d=json.load(sys.stdin); print(d$1)"; }
base=http://127.0.0.1:2785/api/sessions

SID="$(grep -E '^OPENWA_SESSION=' .env | cut -d= -f2- || true)"
if [ -z "$SID" ]; then
  SID="$(api "$base" | python3 -c "import json,sys
d=json.load(sys.stdin); d=d.get('data',d) if isinstance(d,dict) else d
print(next((s['id'] for s in d if s.get('name')=='jp-alerts'),''))")"
fi
if [ -z "$SID" ]; then SID="$(api -X POST "$base" -d '{"name":"jp-alerts"}' | json "['id']")"; fi
echo "Session: jp-alerts"

status() { api "$base/$SID" | json ".get('status','')"; }
if [ "$(status)" != "ready" ]; then
  api -X POST "$base/$SID/start" >/dev/null 2>&1 || true
  for i in $(seq 1 40); do s="$(status)"; [ "$s" = qr_ready ] || [ "$s" = ready ] && break; sleep 3; done
fi
if [ "$(status)" != "ready" ]; then
  CODE="$(api -X POST "$base/$SID/pairing-code" -d "{\"phoneNumber\":\"$PHONE\"}" | json "['pairingCode']")"
  echo
  echo "  PAIRING CODE:  $CODE"
  echo
  echo "  On the phone with +$PHONE: WhatsApp → Linked devices → Link a device"
  echo "  → 'Link with phone number instead' → enter the code. Waiting up to 5 minutes…"
  for i in $(seq 1 100); do [ "$(status)" = ready ] && break; sleep 3; done
fi
[ "$(status)" = ready ] || { echo "Not linked yet. Run this script again for a new code."; exit 1; }
echo "== WhatsApp linked =="

set_env() {
  if grep -qE "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else printf '%s=%s\n' "$1" "$2" >> .env; fi
}
set_env WHATSAPP_PROVIDER openwa
set_env OPENWA_URL http://openwa:2785
set_env OPENWA_API_KEY "$KEY"
set_env OPENWA_SESSION "$SID"
chmod 600 .env
docker compose --env-file .env up -d api >/dev/null
echo "== Done: the app now sends WhatsApp alerts (key saved in .env, not shown) =="
echo "Each person turns on WhatsApp in the app: More → Alert settings → mobile + WhatsApp Yes."
REMOTE
