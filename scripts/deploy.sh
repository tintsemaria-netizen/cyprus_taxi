#!/usr/bin/env bash
# IL-Y production deploy with a health gate and automatic rollback (2026-10-01 audit, Stage 1.6).
#
#   sudo scripts/deploy.sh [--skip-backup] [--allow-dirty]
#
# 1. refuses a dirty working tree (the image must match a commit);
# 2. encrypted DB backup (deploy/backup.sh) before migrations;
# 3. builds taxicy-taxi-app:<git sha> — the sha is baked into the image (label + APP_RELEASE_BUILT),
#    and the build must succeed before anything is restarted;
# 4. verifies the image label equals the commit;
# 5. starts web + worker on that tag (the web entrypoint applies migrations);
# 6. health gate (default 180 s): /health/live reports the new release from the IMAGE, status live,
#    dispatch + notifications alive, and both containers run the new image;
# 7. on failure, rolls web + worker back to the previously running tag and exits non-zero.
#    Migrations are forward-only: keep them additive so the previous image still runs.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
ENV_FILE="deploy/.env.production"
IMAGE="taxicy-taxi-app"
GATE_SECONDS="${DEPLOY_GATE_SECONDS:-180}"
SKIP_BACKUP=0; ALLOW_DIRTY=0
for a in "$@"; do
  case "$a" in
    --skip-backup) SKIP_BACKUP=1 ;;
    --allow-dirty) ALLOW_DIRTY=1 ;;
    *) echo "unknown option: $a"; exit 2 ;;
  esac
done

log() { echo "[deploy] $(date -u +%T) $*"; }
git_() { git -c safe.directory="$ROOT" "$@"; }

[ "$(id -u)" -eq 0 ] || { echo "run with sudo (docker access)"; exit 2; }
NEW="$(git_ rev-parse HEAD)"
if [ "$ALLOW_DIRTY" -eq 0 ] && [ -n "$(git_ status --porcelain --untracked-files=no)" ]; then
  echo "working tree has uncommitted changes — commit first (or --allow-dirty)"; exit 2
fi
PORT="$(grep -E '^APP_HOST_PORT=' "$ENV_FILE" | cut -d= -f2)"; PORT="${PORT:-8097}"
PREV="$(docker inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' taxicy-app 2>/dev/null || true)"
if [ -z "$PREV" ] || ! docker image inspect "$IMAGE:$PREV" >/dev/null 2>&1; then
  # Running image predates release labels/tags: pin it under a tag so we can still roll back to it.
  CUR_ID="$(docker inspect -f '{{.Image}}' taxicy-app 2>/dev/null || true)"
  if [ -n "$CUR_ID" ]; then PREV="pre-$(date -u +%Y%m%d%H%M%S)"; docker tag "$CUR_ID" "$IMAGE:$PREV"; else PREV=""; fi
fi
log "deploying ${NEW:0:7} (rollback target: ${PREV:-none})"

# 2) backup
if [ "$SKIP_BACKUP" -eq 0 ]; then
  log "backup…"
  BACKUP_DIR="$ROOT/deploy/backups" BACKUP_PASSPHRASE_FILE="$ROOT/deploy/secrets/backup.pass" /bin/bash "$ROOT/deploy/backup.sh" | grep -E "pg-|FATAL|WARNING" || true
fi

compose() { APP_RELEASE="$1" docker compose --env-file "$ENV_FILE" "${@:2}"; }

# 3) build (nothing is restarted unless this succeeds)
log "building $IMAGE:${NEW:0:7}…"
BUILD_LOG="$(mktemp)"
if ! compose "$NEW" build taxi-app >"$BUILD_LOG" 2>&1; then
  tail -30 "$BUILD_LOG"; rm -f "$BUILD_LOG"; log "BUILD FAILED — nothing was changed"; exit 1
fi
rm -f "$BUILD_LOG"

# 4) the image must carry this commit
LABEL="$(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$IMAGE:$NEW")"
[ "$LABEL" = "$NEW" ] || { log "image label '$LABEL' != commit $NEW — aborting"; exit 1; }

# 5) start
log "starting web + worker on ${NEW:0:7}…"
compose "$NEW" up -d taxi-app taxi-worker >/dev/null

# 6) health gate
healthy() {
  local body ri rw
  body="$(curl -s --max-time 5 "http://127.0.0.1:$PORT/api/v1/health/live" || true)"
  echo "$body" | grep -q "\"release\":\"$NEW\"" || return 1
  echo "$body" | grep -q '"status":"live"' || return 1
  echo "$body" | grep -q '"dispatch":{"alive":true' || return 1
  echo "$body" | grep -q '"notifications":{"alive":true' || return 1
  ri="$(docker inspect -f '{{.Config.Image}}' taxicy-app)"; rw="$(docker inspect -f '{{.Config.Image}}' taxicy-worker)"
  [ "$ri" = "$IMAGE:$NEW" ] && [ "$rw" = "$IMAGE:$NEW" ]
}
deadline=$(( $(date +%s) + GATE_SECONDS ))
until healthy; do
  if [ "$(date +%s)" -ge "$deadline" ]; then
    log "HEALTH GATE FAILED after ${GATE_SECONDS}s"
    docker logs --tail 40 taxicy-app 2>&1 | sed 's/^/  app: /'
    if [ -n "$PREV" ] && docker image inspect "$IMAGE:$PREV" >/dev/null 2>&1; then
      log "rolling back to ${PREV:0:7}…"
      compose "$PREV" up -d taxi-app taxi-worker >/dev/null
      log "rolled back. NOTE: migrations applied by the failed release were NOT reverted."
    else
      log "no previous tagged image to roll back to — investigate now"
    fi
    exit 1
  fi
  sleep 3
done

# 7) success: keep :latest pointing at the running release; keep the last 5 release tags
docker tag "$IMAGE:$NEW" "$IMAGE:latest"
docker images "$IMAGE" --format '{{.Tag}} {{.CreatedAt}}' | grep -vE '^(latest|<none>) ' | sort -k2 -r | awk 'NR>5 {print $1}' \
  | while read -r old; do [ "$old" != "$PREV" ] && docker rmi "$IMAGE:$old" >/dev/null 2>&1 || true; done
log "OK — ${NEW:0:7} is live and healthy"
