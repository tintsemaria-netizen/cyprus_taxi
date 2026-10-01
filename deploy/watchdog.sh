#!/usr/bin/env bash
# IL-Y production watchdog → Telegram alerts (2026-10-01 audit, Stage 0.3).
#
# Runs on the HOST every minute from root cron, independent of the app, so it still pages when the
# app, the worker or the whole Compose stack is down. Each check has a state file: a check must fail
# FAIL_AFTER consecutive runs before an alert is sent (no flapping); while it stays failed a reminder
# goes out every REMIND_MINUTES; recovery sends a ✅ message.
#
# Config (all optional except the Telegram pair): deploy/secrets/telegram.env (chmod 600)
#   TELEGRAM_BOT_TOKEN=...   TELEGRAM_CHAT_ID=...
# Without them the watchdog still runs and logs, it just cannot page.
#
#   deploy/watchdog.sh          run all checks once (cron)
#   deploy/watchdog.sh --test   send a test message to Telegram
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SECRETS="${WATCHDOG_SECRETS:-$ROOT/deploy/secrets/telegram.env}"
STATE_DIR="${WATCHDOG_STATE_DIR:-$ROOT/deploy/watchdog-state}"
APP_URL="${WATCHDOG_APP_URL:-http://127.0.0.1:8097}"
PUBLIC_URL="${WATCHDOG_PUBLIC_URL:-https://cyprustaxi.ackedberryes.store}"
BACKUP_DIR="${WATCHDOG_BACKUP_DIR:-$ROOT/deploy/backups}"
DISK_MAX_PCT="${WATCHDOG_DISK_MAX_PCT:-85}"
BACKUP_MAX_AGE_H="${WATCHDOG_BACKUP_MAX_AGE_H:-26}"
FAIL_AFTER="${WATCHDOG_FAIL_AFTER:-2}"
REMIND_MINUTES="${WATCHDOG_REMIND_MINUTES:-60}"
CONTAINERS="${WATCHDOG_CONTAINERS:-taxicy-app taxicy-worker taxicy-db}"

TELEGRAM_BOT_TOKEN="" ; TELEGRAM_CHAT_ID=""
# shellcheck disable=SC1090
[ -f "$SECRETS" ] && . "$SECRETS"
mkdir -p "$STATE_DIR"
HOST="$(hostname)"

log() { echo "[watchdog] $(date -u +%FT%TZ) $*"; }

send() {
  local text="$1"
  if [ -z "$TELEGRAM_BOT_TOKEN" ] || [ -z "$TELEGRAM_CHAT_ID" ]; then
    log "telegram not configured — would send: $text"; return 0
  fi
  curl -sS --max-time 15 -o /dev/null -w '%{http_code}' \
    "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
    --data-urlencode "text=${text}" \
    --data-urlencode "disable_web_page_preview=true" | grep -q '^200$' \
    || log "telegram send FAILED"
}

# record <check> <ok|fail> <detail>
record() {
  local name="$1" result="$2" detail="$3"
  local f="$STATE_DIR/$name" now; now=$(date +%s)
  local fails=0 alerted=0 last=0
  [ -f "$f" ] && read -r fails alerted last < "$f"
  if [ "$result" = ok ]; then
    if [ "$alerted" = 1 ]; then send "✅ IL-Y recovered: $name — $detail ($HOST)"; fi
    echo "0 0 0" > "$f"; return
  fi
  fails=$((fails + 1))
  log "FAIL $name ($fails): $detail"
  if [ "$fails" -ge "$FAIL_AFTER" ]; then
    if [ "$alerted" = 0 ]; then
      send "🔴 IL-Y ALERT: $name — $detail ($HOST)"; alerted=1; last=$now
    elif [ $((now - last)) -ge $((REMIND_MINUTES * 60)) ]; then
      send "🔴 IL-Y still failing: $name — $detail ($HOST)"; last=$now
    fi
  fi
  echo "$fails $alerted $last" > "$f"
}

if [ "${1:-}" = "--test" ]; then
  send "🧪 IL-Y watchdog connected on $HOST — alerts will arrive in this chat."
  exit 0
fi

# 1) App + operational loop (dispatch/notifications heartbeats) via the origin.
code=$(curl -s --max-time 10 -o "$STATE_DIR/.live.json" -w '%{http_code}' "$APP_URL/api/v1/health/live" || true)
if [ "$code" = 200 ]; then record app_dispatch ok "health 200"
elif [ "$code" = 000 ]; then record app_dispatch fail "app not responding on $APP_URL"
else record app_dispatch fail "health HTTP $code: $(head -c 300 "$STATE_DIR/.live.json" | tr -d '\n')"; fi

# 2) Public path (Cloudflare → nginx → app).
code=$(curl -s --max-time 15 -o /dev/null -w '%{http_code}' "$PUBLIC_URL/api/v1/health/ready" || true)
if [ "$code" = 200 ]; then record public_url ok "HTTP 200"; else record public_url fail "$PUBLIC_URL/api/v1/health/ready → HTTP $code"; fi

# 3) Containers running.
down=""
for c in $CONTAINERS; do
  st=$(docker inspect -f '{{.State.Status}}' "$c" 2>/dev/null || echo missing)
  [ "$st" = running ] || down="$down $c=$st"
done
if [ -z "$down" ]; then record containers ok "all running"; else record containers fail "not running:$down"; fi

# 4) Disk space on / and the Docker data dir.
pct=$(df -P / | awk 'NR==2 {gsub("%","",$5); print $5}')
if [ "${pct:-100}" -lt "$DISK_MAX_PCT" ]; then record disk ok "/ at ${pct}%"; else record disk fail "/ at ${pct}% (limit ${DISK_MAX_PCT}%)"; fi

# 5) Fresh, non-empty PostgreSQL backup.
newest=$(ls -1t "$BACKUP_DIR"/pg-*.dump.enc 2>/dev/null | head -1)
if [ -z "$newest" ]; then record backup fail "no pg backup in $BACKUP_DIR"
else
  age_h=$(( ($(date +%s) - $(stat -c %Y "$newest")) / 3600 ))
  size=$(stat -c %s "$newest")
  if [ "$age_h" -ge "$BACKUP_MAX_AGE_H" ]; then record backup fail "newest pg backup is ${age_h}h old"
  elif [ "$size" -lt 10240 ]; then record backup fail "newest pg backup only ${size} bytes"
  else record backup ok "$(basename "$newest"), ${age_h}h old"; fi
fi
