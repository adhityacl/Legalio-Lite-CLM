#!/usr/bin/env bash
# Deploy the current branch of this checkout with Docker Compose, verify it is healthy, and roll back if it is not.
#
# Run it on the server, from anywhere:   scripts/deploy.sh
# (CI reaches it through the SSH forced command / login shell of the deploy key; see docs/RUNBOOK.md.)
#
# What it does:
#   1. records the currently deployed git revision (the rollback target)
#   2. optionally takes a database backup first (BACKUP_BEFORE_DEPLOY=1, default when the postgres container is running)
#   3. git fetch + fast-forward to origin/<branch> (no merge commits, no local changes overwritten)
#   4. docker compose build + up -d
#   5. polls GET /api/health/ready until it answers 200, or gives up after DEPLOY_TIMEOUT seconds
#   6. on failure: checks out the previous revision, rebuilds, starts it, and exits non-zero
#
# Environment (all optional):
#   DEPLOY_BRANCH        branch to deploy                      (default: the branch currently checked out)
#   DEPLOY_TIMEOUT       seconds to wait for health            (default: 180)
#   HEALTH_URL           readiness URL to poll                 (default: http://127.0.0.1:${FRONTEND_PORT:-8080}/api/health/ready)
#   BACKUP_BEFORE_DEPLOY 1 to back up first, 0 to skip         (default: 1)
#   COMPOSE              compose command                      (default: "docker compose")
#
# Note: only code is rolled back. Database migrations are forward-only; if a release changed the schema incompatibly,
# restore the pre-deploy backup with scripts/restore.sh (see docs/RUNBOOK.md).
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

COMPOSE=${COMPOSE:-docker compose}
BRANCH=${DEPLOY_BRANCH:-$(git rev-parse --abbrev-ref HEAD)}
TIMEOUT=${DEPLOY_TIMEOUT:-180}
HEALTH_URL=${HEALTH_URL:-http://127.0.0.1:${FRONTEND_PORT:-8080}/api/health/ready}
BACKUP_BEFORE_DEPLOY=${BACKUP_BEFORE_DEPLOY:-1}

log() { printf '[deploy %s] %s\n' "$(date -u +%H:%M:%SZ)" "$*"; }

if [ "$BRANCH" = "HEAD" ]; then
  echo "Detached HEAD: set DEPLOY_BRANCH (for example DEPLOY_BRANCH=main)." >&2
  exit 2
fi
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "The checkout has uncommitted changes; refusing to deploy over them." >&2
  exit 2
fi

wait_healthy() {
  local deadline=$((SECONDS + TIMEOUT))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if curl -fsS -o /dev/null --max-time 5 "$HEALTH_URL"; then return 0; fi
    sleep 3
  done
  return 1
}

PREVIOUS_REV=$(git rev-parse HEAD)
log "current revision: $PREVIOUS_REV (branch $BRANCH)"

if [ "$BACKUP_BEFORE_DEPLOY" = "1" ] && $COMPOSE ps --status running --services 2>/dev/null | grep -qx postgres; then
  log "taking a pre-deploy database backup"
  scripts/backup.sh || log "WARNING: backup failed; continuing"
fi

log "fetching origin/$BRANCH"
git fetch --prune origin "$BRANCH"
git checkout "$BRANCH"
git merge --ff-only "origin/$BRANCH"
NEW_REV=$(git rev-parse HEAD)
log "deploying revision: $NEW_REV"

rollback() {
  log "ROLLBACK to $PREVIOUS_REV"
  git checkout --quiet "$PREVIOUS_REV"
  $COMPOSE up -d --build
  if wait_healthy; then
    log "rolled back; $PREVIOUS_REV is healthy again (checkout is now detached; run scripts/deploy.sh after fixing the branch)"
  else
    log "ERROR: rollback did not become healthy either. Inspect: $COMPOSE ps && $COMPOSE logs --tail=100"
  fi
}

if $COMPOSE up -d --build && wait_healthy; then
  log "healthy: $NEW_REV is live"
  exit 0
fi

log "ERROR: $NEW_REV did not become healthy within ${TIMEOUT}s ($HEALTH_URL)"
$COMPOSE logs --tail=50 backend frontend || true
if [ "$PREVIOUS_REV" = "$NEW_REV" ]; then
  log "no earlier revision to roll back to"
else
  rollback
fi
exit 1
