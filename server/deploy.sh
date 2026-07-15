#!/usr/bin/env bash
#
# deploy.sh -- push this repo's server/ to the VM and restart the API.
#
# RUN FROM YOUR MAC, at the repo root:
#     bash server/deploy.sh                    # deploy + restart + smoke-test
#     bash server/deploy.sh --dry-run          # show what WOULD change, touch nothing
#
# Why this exists: plumber.R used to live ONLY on the VM, so "update the API"
# meant sed-ing a live server whose single copy was the server itself -- no
# history, no review, and no way to know what was actually running. The repo is
# now the source of truth; the VM is only a deploy target. If you edit the VM
# directly, that stops being true and the two silently drift.
#
# NEVER copied: the database (nest_study.sqlite*) and photos/ live only on the
# VM -- they are data, not code. A deploy must never overwrite them.
#
set -euo pipefail

KEY="${KEY:-brian_sandbox/ssh-key-2026-07-06_private.key}"
VM="${VM:-ubuntu@snednestudy.duckdns.org}"
APP_DIR="/opt/nest-api/server"
DRY=""
[ "${1:-}" = "--dry-run" ] && DRY="--dry-run"

cd "$(dirname "$0")/.."   # repo root

[ -f "$KEY" ] || { echo "No ssh key at $KEY (override with KEY=...)" >&2; exit 1; }
[ -f server/plumber.R ] || { echo "Run me from the repo root." >&2; exit 1; }

# Refuse to deploy uncommitted work: what runs on the VM should be a commit you
# can point at, not whatever happened to be in your working tree.
if [ -z "$DRY" ] && ! git diff --quiet -- server; then
  echo "ABORT: server/ has uncommitted changes. Commit them first, so what is" >&2
  echo "       deployed matches a commit in history." >&2
  git status --porcelain -- server >&2
  exit 1
fi

REV="$(git rev-parse --short HEAD)"
echo "== deploying server/ @ ${REV} -> ${VM}:${APP_DIR} =="

# 1. Code only. --checksum (not mtime) so a re-checkout doesn't churn files.
#    The excludes are load-bearing: they protect live data.
rsync -avz --checksum $DRY \
  -e "ssh -i $KEY" \
  --exclude='*.sqlite' --exclude='*.sqlite-*' \
  --exclude='photos/' --exclude='*.bak*' --exclude='deploy.sh' \
  server/ "$VM:/tmp/nest-api-deploy/"

[ -n "$DRY" ] && { echo "(dry run: nothing was installed or restarted)"; exit 0; }

# 2. Install as nestapi, back up what was there, install the view, restart.
ssh -i "$KEY" "$VM" "REV='$REV' APP_DIR='$APP_DIR' bash -s" <<'REMOTE'
set -euo pipefail
sudo cp -a "$APP_DIR/plumber.R" "$APP_DIR/plumber.R.bak-$(date +%F-%H%M)" 2>/dev/null || true
sudo cp -a /tmp/nest-api-deploy/. "$APP_DIR/"
sudo chown -R nestapi:nestapi "$APP_DIR"
rm -rf /tmp/nest-api-deploy

# The view ships with the API: a route can select columns that only the new view
# has, so install it in the same breath rather than as a step someone forgets.
if [ -f "$APP_DIR/v_map_point.sql" ]; then
  sudo -u nestapi sqlite3 "$APP_DIR/nest_study.sqlite" < "$APP_DIR/v_map_point.sql"
  echo "installed v_map_point"
fi

sudo systemctl restart nest-api
sleep 2
systemctl is-active --quiet nest-api && echo "nest-api: active ($REV)" || {
  echo "nest-api FAILED to start -- restoring the previous plumber.R" >&2
  LAST=$(ls -t "$APP_DIR"/plumber.R.bak-* 2>/dev/null | head -1)
  [ -n "$LAST" ] && sudo cp -a "$LAST" "$APP_DIR/plumber.R" && sudo systemctl restart nest-api
  journalctl -u nest-api -n 20 --no-pager >&2
  exit 1
}
REMOTE

# 3. Smoke-test: the API must actually answer, not merely be "active".
echo "== smoke test =="
ssh -i "$KEY" "$VM" '
  code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8000/lookups || echo 000)
  t=$(curl -s -o /dev/null -w "%{time_total}" http://127.0.0.1:8000/nests || echo "?")
  echo "  /lookups -> HTTP $code"
  echo "  /nests   -> ${t}s"
  [ "$code" = "200" ] || [ "$code" = "401" ] || { echo "  API is not responding properly" >&2; exit 1; }
'
echo "== done: ${REV} deployed =="
