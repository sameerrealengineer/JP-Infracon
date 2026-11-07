#!/usr/bin/env bash
# Builds the web app and puts it on the Azure server, where Caddy serves it at the server's
# address (for iPhone users: open it in Safari → Share → Add to Home Screen).
# The web app talks to the API on the same address, so no server address is baked in.
# Run scripts/deploy-azure.sh once first so Caddy knows about the web folder.
set -euo pipefail

HOST="${JP_DEPLOY_HOST:-jpadmin@jpinfracon.centralindia.cloudapp.azure.com}"
cd "$(git rev-parse --show-toplevel)"

if [ -n "$(git status --porcelain)" ]; then
  echo "Uncommitted changes. Commit first, then deploy." >&2
  exit 1
fi

OUT="$(mktemp -d)/web"
echo "== 1/3 Build the web app ($(git log --oneline -1)) =="
EXPO_PUBLIC_API_BASE_URL= npx expo export --platform web --output-dir "$OUT" >/dev/null
test -f "$OUT/index.html" || { echo "Web build has no index.html, stopping." >&2; exit 1; }

echo "== 2/3 Copy to the server =="
# Unpack beside the live folder, then swap its contents in one step so users never see half a site.
tar -C "$OUT" -czf - . | ssh "$HOST" 'set -e; rm -rf ~/jp-web.new; mkdir -p ~/jp-web.new ~/jp-web; \
  tar -xzf - -C ~/jp-web.new; \
  find ~/jp-web -mindepth 1 -maxdepth 1 -exec rm -rf {} +; \
  cp -a ~/jp-web.new/. ~/jp-web/; rm -rf ~/jp-web.new'

echo "== 3/3 Check =="
code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "https://${HOST#*@}/" || true)
api=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "https://${HOST#*@}/api/health" || true)
echo "web: HTTP $code · api: HTTP $api"
[ "$code" = "200" ] && [ "$api" = "200" ] || { echo "WEB DEPLOY CHECK FAILED" >&2; exit 1; }
echo "Web app: https://${HOST#*@}/  (iPhone: Safari → Share → Add to Home Screen)"
rm -rf "$(dirname "$OUT")"
