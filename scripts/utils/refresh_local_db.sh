#!/usr/bin/env bash
# refresh_local_db.sh -------------------------------------------------------
# Replace the local analysis DB with a fresh snapshot of the VM's live REST-API
# database (the source of truth for app-entered nests/gps/intervals/photos/
# tracks/schedule). Safe: it makes a clean VACUUM INTO snapshot on the VM, pulls
# it to a TEMP file, validates it, and only THEN swaps it over the local DB --
# so an interrupted/failed pull never corrupts the local copy.
#
# Note: this OVERWRITES the local DB, so any local-only inserts (db_insert.R)
# are lost, and the batch tables (point counts / visits) must be re-layered
# afterward with nightly_load.R (updater.R does this automatically).
#
#   bash scripts/utils/refresh_local_db.sh [ssh_key] [local_db]
set -euo pipefail

KEY="${1:-brian_sandbox/ssh-key-2026-07-06_private.key}"
LOCAL_DB="${2:-nest_study.sqlite}"
VM="ubuntu@snednestudy.duckdns.org"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

# 1. Clean, WAL-free snapshot on the VM, as nestapi (owns the live DB). The
#    quoted heredoc is parsed by the REMOTE shell, so the nested SQL quoting
#    ('"'"' = a literal single quote) resolves there, not here.
ssh -i "$KEY" "$VM" 'bash -s' <<'REMOTE'
set -e
sudo rm -f /tmp/nest_snapshot.sqlite
sudo -u nestapi env NEST_DB_PATH=/opt/nest-api/server/nest_study.sqlite \
  Rscript -e 'library(DBI); con<-dbConnect(RSQLite::SQLite(), Sys.getenv("NEST_DB_PATH")); dbExecute(con, "VACUUM INTO '"'"'/tmp/nest_snapshot.sqlite'"'"'"); dbDisconnect(con)'
sudo chmod a+r /tmp/nest_snapshot.sqlite
REMOTE

# 2. Pull the snapshot to a temp file.
scp -i "$KEY" "$VM:/tmp/nest_snapshot.sqlite" "$TMP"

# 3. Validate it's a real DB with the expected tables, THEN swap it in.
Rscript -e "library(DBI); con<-dbConnect(RSQLite::SQLite(), '$TMP'); ok<-all(c('nest','gps_point') %in% dbListTables(con)); dbDisconnect(con); quit(status=if (ok) 0 else 1)"

mv "$TMP" "$LOCAL_DB"
trap - EXIT
rm -f "${LOCAL_DB}-wal" "${LOCAL_DB}-shm"
echo "refresh_local_db: $LOCAL_DB replaced with the VM snapshot."
