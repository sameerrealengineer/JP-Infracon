#!/usr/bin/env bash
# Wipes the JP Infracon database on the Azure server and starts it fresh.
#   bash scripts/reset-production-db.sh
# 1. Takes a backup first (stops if the backup looks empty or fails).
# 2. Asks you to type the confirmation phrase. Nothing is deleted without it.
# 3. Drops and recreates the jp_infracon database, restarts the API; every migration
#    applies again on start, so the schema is complete and empty.
# 4. Uploaded files are kept (they are useless without rows but harmless); see the end.
# After this, create the first Super Admin again with the one-time bootstrap flow in the app.
# Restore the backup instead: gunzip -c ~/backups/<file>.sql.gz | docker compose exec -T mysql ...
set -euo pipefail

HOST="${JP_DEPLOY_HOST:-jpadmin@jpinfracon.centralindia.cloudapp.azure.com}"
PHRASE="DELETE ALL JP DATA"

echo "== 1/3 Backup =="
ssh "$HOST" 'set -e; bash ~/backup.sh; f=$(ls -t ~/backups/*.sql.gz | head -1); \
  s=$(stat -c %s "$f"); echo "backup: $f ($s bytes)"; [ "$s" -gt 1000 ] || { echo "Backup looks empty, stopping."; exit 1; }'

echo
echo "This deletes EVERY user, company, site, report, bill and payment on the live server."
read -r -p "Type exactly '$PHRASE' to continue: " answer
[ "$answer" = "$PHRASE" ] || { echo "Not confirmed. Nothing was deleted."; exit 1; }

echo "== 2/3 Wipe and recreate =="
ssh "$HOST" 'set -e; cd ~/jp-infracon/deploy; \
  docker compose --env-file .env stop api >/dev/null; \
  docker compose exec -T mysql sh -c "mysql -uroot -p\"\$MYSQL_ROOT_PASSWORD\" -e \"DROP DATABASE jp_infracon; CREATE DATABASE jp_infracon CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; GRANT ALL ON jp_infracon.* TO '"'"'jp'"'"'@'"'"'%'"'"';\"" 2>&1 | grep -v Warning || true; \
  docker compose --env-file .env up -d api >/dev/null; sleep 25; \
  docker compose logs --tail 15 api | grep -v -i -E "key|secret|password|token"'

echo "== 3/3 Check =="
curl -fsS -o /dev/null -w "API health: HTTP %{http_code}\n" "https://${HOST#*@}/api/health" ||
  echo "API health check failed"
echo "Done. Open the app and create the first Super Admin with the bootstrap secret."
