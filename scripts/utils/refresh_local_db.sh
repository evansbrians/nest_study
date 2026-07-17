#!/usr/bin/env bash

# Replace the local analysis DB with a fresh snapshot of the VM's live REST-API
# database 

set -euo pipefail

# The key is personal and never in git, so its path differs per machine. Every
# contributor sets NEST_SSH_KEY (e.g. in ~/.Renviron, which R exports to this
# script) or passes it as $1.
#
# There is deliberately NO default. It used to fall back to one contributor's
# gitignored key, which meant the script worked for exactly one person and told
# everyone else their key was missing from a sandbox path they'd never heard of.

KEY="${1:-${NEST_SSH_KEY:-}}"
LOCAL_DB="${2:-nest_study.sqlite}"
VM="${NEST_VM:-ubuntu@snednestudy.duckdns.org}"

if [ -z "$KEY" ]; then
  echo "refresh_local_db: NEST_SSH_KEY is not set." >&2
  echo "  Add your key's path to ~/.Renviron, then restart R:" >&2
  echo "    NEST_SSH_KEY=/Users/you/.ssh/nest_vm_key" >&2
  echo "  Check it took with Sys.getenv(\"NEST_SSH_KEY\") in the R console." >&2
  exit 1
fi

if [ ! -f "$KEY" ]; then
  echo "refresh_local_db: no SSH key at '$KEY'." >&2
  echo "  Set NEST_SSH_KEY to your key, e.g. in ~/.Renviron:" >&2
  echo "    NEST_SSH_KEY=/Users/you/.ssh/nest_vm_key" >&2
  echo "  The key must be chmod 600, and its VM account needs sudo." >&2
  exit 1
fi

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
