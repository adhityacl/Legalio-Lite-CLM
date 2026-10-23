#!/usr/bin/env bash
# Restore a dump made by scripts/backup.sh into the PostgreSQL database of a Docker Compose install.
#
#   scripts/restore.sh backups/legalio-20260101T020000Z.dump            (asks for confirmation)
#   scripts/restore.sh --yes backups/legalio-20260101T020000Z.dump      (no prompt)
#
# DESTRUCTIVE: the target database's current contents are replaced (pg_restore --clean --if-exists).
# Stop the application first so nothing writes during the restore:   docker compose stop backend frontend
# Then start it again:                                               docker compose up -d
#
# Environment (all optional):
#   RESTORE_DATABASE_URL  restore into this database with local pg_restore instead of Docker Compose
#                         (use an empty scratch database to test a backup without touching production)
#   COMPOSE, PG_SERVICE   as in backup.sh
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

COMPOSE=${COMPOSE:-docker compose}
PG_SERVICE=${PG_SERVICE:-postgres}
assume_yes=0
if [ "${1:-}" = "--yes" ]; then assume_yes=1; shift; fi
dump=${1:-}

if [ -z "$dump" ] || [ ! -s "$dump" ]; then
  echo "Usage: scripts/restore.sh [--yes] <dump-file>" >&2
  exit 2
fi

target="the '$PG_SERVICE' service database"
[ -n "${RESTORE_DATABASE_URL:-}" ] && target="the database at RESTORE_DATABASE_URL"
if [ "$assume_yes" != "1" ]; then
  printf 'This REPLACES the contents of %s with %s. Type "restore" to continue: ' "$target" "$dump"
  read -r answer
  [ "$answer" = "restore" ] || { echo "Aborted."; exit 1; }
fi

if [ -n "${RESTORE_DATABASE_URL:-}" ]; then
  pg_restore --clean --if-exists --no-owner --exit-on-error --dbname "$RESTORE_DATABASE_URL" "$dump"
else
  $COMPOSE exec -T "$PG_SERVICE" sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_restore --clean --if-exists --no-owner --exit-on-error -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$dump"
fi
echo "Restore finished. Start the application again and check /api/health/ready."
