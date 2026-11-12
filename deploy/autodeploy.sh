#!/usr/bin/env bash
# IL-Y auto-deploy: pull GitHub `main` and run scripts/deploy.sh when it has a new commit.
#
# Runs as root from the systemd timer deploy/systemd/taxicy-autodeploy.timer (every 2 min).
# Git commands run as the repo owner so .git never gets root-owned files; only deploy.sh
# (docker) runs as root. Safety rules:
#   - never touches a working tree with uncommitted tracked changes, a branch other than
#     master, or local commits that are not on origin/main (fast-forward only);
#   - a commit whose deploy failed is not retried (each attempt = backup + build); the next
#     push retries. Clear it by hand with: sudo rm /var/lib/taxicy-autodeploy/failed-sha
#   - one run at a time (flock).
# Result goes to journald (journalctl -u taxicy-autodeploy) and to Telegram when
# deploy/secrets/telegram.env is configured (same bot as deploy/watchdog.sh).
#
#   sudo deploy/autodeploy.sh        check once (what the timer runs)
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STATE_DIR="${AUTODEPLOY_STATE_DIR:-/var/lib/taxicy-autodeploy}"
BRANCH="${AUTODEPLOY_BRANCH:-main}"
LOCAL_BRANCH="master"
OWNER="$(stat -c %U "$ROOT/.git")"

log() { echo "[autodeploy] $*"; }
as_owner() { runuser -u "$OWNER" -- "$@"; }
git_() { as_owner git -C "$ROOT" "$@"; }

notify() {
  local f="$ROOT/deploy/secrets/telegram.env" TELEGRAM_BOT_TOKEN="" TELEGRAM_CHAT_ID=""
  # shellcheck disable=SC1090
  [ -r "$f" ] && . "$f"
  [ -n "$TELEGRAM_BOT_TOKEN" ] && [ -n "$TELEGRAM_CHAT_ID" ] || return 0
  curl -s --max-time 10 -o /dev/null "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" --data-urlencode "text=$1" || true
}

[ "$(id -u)" -eq 0 ] || { echo "run as root (docker access)"; exit 2; }
mkdir -p "$STATE_DIR"
exec 9>"$STATE_DIR/lock"
flock -n 9 || { log "another run is in progress"; exit 0; }

git_ fetch -q origin "$BRANCH" || { log "git fetch failed"; exit 1; }
HEAD_SHA="$(git_ rev-parse HEAD)"
REMOTE_SHA="$(git_ rev-parse "origin/$BRANCH")"
[ "$HEAD_SHA" = "$REMOTE_SHA" ] && exit 0

if [ "$(cat "$STATE_DIR/failed-sha" 2>/dev/null)" = "$REMOTE_SHA" ]; then
  exit 0 # already failed on this commit; wait for the next push
fi

CUR_BRANCH="$(git_ rev-parse --abbrev-ref HEAD)"
if [ "$CUR_BRANCH" != "$LOCAL_BRANCH" ]; then
  log "checkout is on '$CUR_BRANCH', not $LOCAL_BRANCH — skipping"; exit 1
fi
if [ -n "$(git_ status --porcelain --untracked-files=no)" ]; then
  log "uncommitted changes in $ROOT — skipping ${REMOTE_SHA:0:7}"; exit 1
fi
if ! git_ merge-base --is-ancestor HEAD "origin/$BRANCH"; then
  log "local $LOCAL_BRANCH has commits not on origin/$BRANCH — cannot fast-forward, skipping"; exit 1
fi

SUBJECT="$(git_ log -1 --format=%s "origin/$BRANCH")"
log "new commit ${REMOTE_SHA:0:7} ($SUBJECT), was ${HEAD_SHA:0:7}"
git_ merge -q --ff-only "origin/$BRANCH" || { log "fast-forward failed"; exit 1; }

if "$ROOT/scripts/deploy.sh"; then
  rm -f "$STATE_DIR/failed-sha"
  log "deployed ${REMOTE_SHA:0:7}"
  notify "✅ IL-Y auto-deploy: ${REMOTE_SHA:0:7} is live — $SUBJECT"
else
  echo "$REMOTE_SHA" >"$STATE_DIR/failed-sha"
  log "deploy of ${REMOTE_SHA:0:7} FAILED (see output above); will not retry this commit"
  notify "❌ IL-Y auto-deploy FAILED for ${REMOTE_SHA:0:7} — $SUBJECT. Previous release kept/rolled back. journalctl -u taxicy-autodeploy"
  exit 1
fi
