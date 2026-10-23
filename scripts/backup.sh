#!/usr/bin/env bash
# Back up the PostgreSQL database of a Docker Compose install into a timestamped pg_dump custom-format file.
#
#   scripts/backup.sh                      -> backups/legalio-YYYYmmddTHHMMSSZ.dump
#
# Environment (all optional):
#   BACKUP_DIR        where dumps go                          (default: ./backups, git-ignored)
#   BACKUP_RETENTION  number of newest dumps to keep          (default: 14; 0 keeps everything)
#   COMPOSE           compose command                         (default: "docker compose")
#   PG_SERVICE        compose service running PostgreSQL      (default: postgres)
#   DATABASE_URL      if set, run the local `pg_dump` against it instead of using Docker Compose
#
# This backs up the database only. Uploaded files live in Tencent COS (enable bucket versioning), and
# BETTER_AUTH_SECRET must be backed up separately: see docs/RUNBOOK.md.
set -euo pipefail
umask 077

cd "$(dirname "${BASH_SOURCE[0]}")/.."

BACKUP_DIR=${BACKUP_DIR:-backups}
RETENTION=${BACKUP_RETENTION:-14}
COMPOSE=${COMPOSE:-docker compose}
PG_SERVICE=${PG_SERVICE:-postgres}

mkdir -p "$BACKUP_DIR"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
out="$BACKUP_DIR/legalio-$stamp.dump"
tmp="$out.partial"
trap 'rm -f "$tmp"' EXIT

if [ -n "${DATABASE_URL:-}" ]; then
  pg_dump --format=custom --no-owner --dbname "$DATABASE_URL" > "$tmp"
else
  # -T: no TTY, so the binary stream is not mangled. Credentials come from the container's own environment.
  $COMPOSE exec -T "$PG_SERVICE" sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump --format=custom --no-owner -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > "$tmp"
fi

# A dump that cannot be listed is not a backup.
if command -v pg_restore >/dev/null 2>&1; then
  pg_restore --list "$tmp" >/dev/null
elif [ ! -s "$tmp" ]; then
  echo "Backup is empty; aborting." >&2
  exit 1
fi
mv "$tmp" "$out"
trap - EXIT
echo "Backup written: $out ($(du -h "$out" | cut -f1))"

if [ "$RETENTION" -gt 0 ]; then
  # Names sort chronologically; delete everything but the newest $RETENTION.
  # shellcheck disable=SC2012
  ls -1 "$BACKUP_DIR"/legalio-*.dump 2>/dev/null | sort -r | tail -n +"$((RETENTION + 1))" | while read -r old; do
    rm -f -- "$old"
    echo "Removed old backup: $old"
  done
fi
