#!/usr/bin/env bash
# Deploy the current commit to the Azure server.
# 1. Takes a fresh database backup (stops if it fails).
# 2. Copies the code (git archive of HEAD) to ~/jp-infracon.
# 3. Rebuilds and restarts the stack; new migrations apply on start.
# 4. Shows whether AI keys are set (yes/no only, never the values).
set -euo pipefail

HOST="${JP_DEPLOY_HOST:-jpadmin@jpinfracon.centralindia.cloudapp.azure.com}"
cd "$(git rev-parse --show-toplevel)"

if [ -n "$(git status --porcelain)" ]; then
  echo "Uncommitted changes. Commit first, then deploy." >&2
  exit 1
fi

echo "== 1/4 Backup =="
ssh "$HOST" 'set -e; bash ~/backup.sh; f=$(ls -t ~/backups/*.sql.gz | head -1); \
  s=$(stat -c %s "$f"); echo "backup: $f ($s bytes)"; [ "$s" -gt 1000 ] || { echo "Backup looks empty, stopping."; exit 1; }'

echo "== 2/4 Copy code ($(git log --oneline -1)) =="
git archive HEAD | ssh "$HOST" 'cd ~/jp-infracon && tar -x'

echo "== 3/4 Build and restart (5-10 minutes) =="
ssh "$HOST" 'cd ~/jp-infracon/deploy && docker compose --env-file .env up -d --build && sleep 20 && \
  docker compose logs --tail 40 api | grep -v -i -E "key|secret|password|token"'

echo "== 4/4 Checks =="
ssh "$HOST" 'cd ~/jp-infracon/deploy; for k in GEMINI_API_KEY SARVAM_API_KEY; do \
  if grep -q "^$k=..*" .env; then echo "$k: set"; else echo "$k: NOT set"; fi; done; \
  docker compose ps --format "{{.Name}}: {{.Status}}"'
curl -fsS -o /dev/null -w "API health: HTTP %{http_code}\n" \
  "https://${HOST#*@}/api/health" || echo "API health check failed"
