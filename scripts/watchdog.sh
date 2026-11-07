#!/usr/bin/env bash
# Server watchdog. Runs on the production VM every 2 minutes from cron (installed by
# scripts/deploy-azure.sh). It:
#   - checks https://$DOMAIN/api/health (API and database);
#   - after 2 failed checks in a row starts any stopped service and restarts the API;
#   - sends a WhatsApp message (local OpenWA) to WATCHDOG_ALERT_PHONE when the server goes down,
#     every 30 minutes while it stays down, and when it works again;
#   - warns once a day when the disk is over 85% full or the newest backup is over 36 hours old.
# Reads deploy/.env but never prints a value from it. Log: ~/watchdog.log
set -uo pipefail

DEPLOY="${JP_DEPLOY_DIR:-$HOME/jp-infracon/deploy}"
STATE="$HOME/.jp-watchdog"
mkdir -p "$STATE"
log() { echo "$(date -u +%FT%TZ) $*"; }
envval() { grep -E "^$1=" "$DEPLOY/.env" 2>/dev/null | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }

DOMAIN="$(envval DOMAIN)"
[ -n "$DOMAIN" ] || { log "DOMAIN missing in $DEPLOY/.env"; exit 1; }

notify() {
  local text="$1" phones key session digits
  phones="$(envval WATCHDOG_ALERT_PHONE)"
  key="$(envval OPENWA_API_KEY)"
  session="$(envval OPENWA_SESSION)"
  if [ -z "$phones" ] || [ -z "$key" ] || [ -z "$session" ]; then
    log "alert not sent (set WATCHDOG_ALERT_PHONE and OpenWA in .env): $text"
    return
  fi
  for phone in ${phones//,/ }; do
    digits="${phone//[^0-9]/}"
    [ "${#digits}" -eq 10 ] && digits="91$digits"
    if curl -fsS --max-time 20 -X POST \
      "http://127.0.0.1:2785/api/sessions/${session}/messages/send-text" \
      -H "Content-Type: application/json" -H "X-API-Key: $key" \
      -d "{\"chatId\":\"${digits}@c.us\",\"text\":\"${text}\"}" >/dev/null 2>&1; then
      log "alert sent to ...${digits: -4}"
    else
      log "alert to ...${digits: -4} failed (is OpenWA running and linked?)"
    fi
  done
}

once_a_day() { # once_a_day <name>: true the first time today
  local file="$STATE/$1-day" today
  today="$(date +%F)"
  [ "$(cat "$file" 2>/dev/null)" = "$today" ] && return 1
  echo "$today" >"$file"
}

code="$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "https://${DOMAIN}/api/health")"
fails="$(cat "$STATE/fails" 2>/dev/null || echo 0)"
when="$(TZ=Asia/Kolkata date '+%d %b %H:%M')"

if [ "$code" = "200" ]; then
  if [ -f "$STATE/down" ]; then
    notify "✅ JP Infracon server is working again ($when IST)."
    rm -f "$STATE/down"
    log "recovered"
  fi
  echo 0 >"$STATE/fails"
else
  fails=$((fails + 1))
  echo "$fails" >"$STATE/fails"
  log "health check failed: HTTP $code (failure $fails)"
  if [ "$fails" -eq 2 ]; then
    cd "$DEPLOY" || exit 1
    docker compose --env-file .env up -d >/dev/null 2>&1 || log "compose up failed"
    docker compose --env-file .env restart api >/dev/null 2>&1 && log "restarted api"
    touch "$STATE/down"
    notify "⚠️ JP Infracon server was not answering (HTTP $code) at $when IST. It was restarted automatically. You will get a message when it works again."
  elif [ "$fails" -gt 2 ] && [ $((fails % 15)) -eq 0 ]; then
    notify "🔴 JP Infracon server is still down (HTTP $code) for about $((fails * 2)) minutes. Check it: docker compose logs api --tail 60"
  fi
fi

use="$(df --output=pcent / | tail -1 | tr -dc 0-9)"
if [ "${use:-0}" -ge 85 ] && once_a_day disk; then
  notify "💾 JP Infracon server disk is ${use}% full. Remove old files or grow the disk."
  log "disk ${use}%"
fi

newest="$(ls -t "$HOME"/backups/*.sql.gz 2>/dev/null | head -1)"
if [ -z "$newest" ] || [ $(( $(date +%s) - $(stat -c %Y "$newest") )) -gt 129600 ]; then
  if once_a_day backup; then
    notify "🗄️ JP Infracon: no database backup in the last 36 hours. Check ~/backup.sh and cron."
    log "backup is old or missing"
  fi
fi
