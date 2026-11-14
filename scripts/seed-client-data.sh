#!/usr/bin/env bash
# Puts the client's start data on the Azure server (one time, after the Super Admin exists):
#   bash scripts/seed-client-data.sh <super-admin-username>
# 1. Takes a database backup (stops if it fails or looks empty).
# 2. Bundles scripts/seed-client-data.ts and runs it inside the API container, as the Super Admin,
#    through the real API rules. It adds nothing if the site ASKA-KM1 already exists.
# 3. Adds the new logins' temporary passwords to ~/jp-seed-logins.txt on the server (mode 600);
#    read them with: ssh <server> cat ~/jp-seed-logins.txt
set -euo pipefail

HOST="${JP_DEPLOY_HOST:-jpadmin@jpinfracon.centralindia.cloudapp.azure.com}"
ADMIN="${1:?Give the Super Admin username}"
cd "$(git rev-parse --show-toplevel)"
OUT="$(mktemp -d)"

echo "== 1/3 Backup =="
ssh -n "$HOST" 'set -e; bash ~/backup.sh; f=$(ls -t ~/backups/*.sql.gz | head -1); \
  s=$(stat -c %s "$f"); echo "backup: $f ($s bytes)"; [ "$s" -gt 1000 ] || { echo "Backup looks empty, stopping."; exit 1; }'

echo "== 2/3 Build and run =="
npx esbuild scripts/seed-client-data.ts --platform=node --target=node22 --bundle --format=esm \
  --outfile="$OUT/seed.mjs" --log-level=warning \
  --banner:js="import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);"
ssh "$HOST" 'cat > /tmp/jp-seed.mjs' < "$OUT/seed.mjs"
ssh -n "$HOST" "set -e; cd ~/jp-infracon/deploy; \
  docker compose cp /tmp/jp-seed.mjs api:/app/jp-seed.mjs; rm -f /tmp/jp-seed.mjs; \
  docker compose exec -T -e SEED_SUPER_ADMIN='$ADMIN' -e SEED_LOGINS_FILE=/tmp/jp-seed-logins.txt api node /app/jp-seed.mjs; \
  if docker compose exec -T api test -f /tmp/jp-seed-logins.txt; then \
    umask 077; docker compose exec -T api cat /tmp/jp-seed-logins.txt >> ~/jp-seed-logins.txt; \
    docker compose exec -T -u root api rm -f /tmp/jp-seed-logins.txt; fi; \
  docker compose exec -T -u root api rm -f /app/jp-seed.mjs"
rm -rf "$OUT"

echo "== 3/3 Logins =="
echo "Temporary passwords are in ~/jp-seed-logins.txt on the server (not printed here)."
