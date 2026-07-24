#!/usr/bin/env bash
# provision.sh -- stand up the nest_study API on a fresh Ubuntu VM.
#
# Copy-paste this onto a clean Ubuntu 22.04/24.04 VM (as root or with sudo).
# It installs R + the R packages, Caddy, deploys this server/ dir to
# /opt/nest-api, initializes the DB, installs the systemd units, and starts
# everything. Edit the CONFIG block first.
#
# Idempotent-ish: safe to re-run; it will NOT clobber an existing DB (init_db.R
# refuses to re-init a populated file -- delete it by hand to rebuild).
#
# Usage:
#   sudo bash provision.sh
set -euo pipefail

# ------------------------------------------------------------------ CONFIG --
DOMAIN="snednestudy.duckdns.org"          # <-- your real domain (DNS -> this VM)
ACME_EMAIL="bsevans.unc@gmail.com"     # <-- Let's Encrypt contact
APP_DIR="/opt/nest-api"            # deploy target
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"   # this server/ directory
REPO_ROOT="$(cd "${SRC_DIR}/.." && pwd)"   # migrate_to_db/ (has schema.sql/seed.sql)
SERVICE_USER="nestapi"
# ---------------------------------------------------------------------------

echo "== provision: installing system packages =="
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends \
  r-base-core r-base-dev \
  build-essential libcurl4-openssl-dev libssl-dev libxml2-dev \
  libsqlite3-dev pkg-config ca-certificates curl gnupg debian-keyring \
  debian-archive-keyring apt-transport-https

echo "== provision: installing R packages =="
# NOTE on sf: we build GeoJSON BY HAND in plumber.R, so sf is NOT required on
# the server. This keeps provisioning light (sf pulls GDAL/GEOS/PROJ). The
# nightly R analysis on a snapshot can use sf on a workstation instead.
# plumber.R itself stays base-R, but the CLI/boot scripts (init_db.R,
# entrypoint.R, mint_token.R) and the migration (migrate/migrate.R) use the
# tidyverse string/data helpers, so install those too.
# Install from Posit's PRECOMPILED binaries (jammy = Ubuntu 22.04) instead of
# source -- on a small VM, compiling stringi/dplyr/etc. from source is slow and
# can OOM. The HTTPUserAgent line is what makes Posit serve binaries, not source.
Rscript -e '
  options(HTTPUserAgent = sprintf(
    "R/%s R (%s)",
    getRversion(),
    paste(getRversion(), R.version["platform"], R.version["arch"], R.version["os"])
  ))
  repo <- "https://packagemanager.posit.co/cran/__linux__/jammy/latest"
  pkgs <- c(
    "plumber", "DBI", "RSQLite", "jsonlite", "digest",
    "magrittr", "stringr", "readr", "purrr",
    "dplyr", "tidyr", "tibble", "lubridate"
  )
  need <- pkgs[!pkgs %in% rownames(installed.packages())]
  if (length(need)) {
    install.packages(need, repos = repo)
  }
  # fail loudly if anything is missing
  for (p in pkgs) library(p, character.only = TRUE)
  cat("R packages OK\n")
'

echo "== provision: installing Caddy =="
if ! command -v caddy >/dev/null 2>&1; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    | tee /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

echo "== provision: creating service user + deploying files =="
id -u "${SERVICE_USER}" >/dev/null 2>&1 || useradd --system --home "${APP_DIR}" --shell /usr/sbin/nologin "${SERVICE_USER}"
mkdir -p "${APP_DIR}/server"
# copy the server dir + the schema/seed it references (one level up)
cp -r "${SRC_DIR}/." "${APP_DIR}/server/"
cp "${REPO_ROOT}/schema.sql" "${APP_DIR}/schema.sql"
cp "${REPO_ROOT}/seed.sql"   "${APP_DIR}/seed.sql"
mkdir -p "${APP_DIR}/server/photos"
chown -R "${SERVICE_USER}:${SERVICE_USER}" "${APP_DIR}"

echo "== provision: initializing the database =="
# init_db.R looks for ../schema.sql + ../seed.sql relative to its own dir, so
# it finds ${APP_DIR}/schema.sql. Skip if a DB already exists.
if [ ! -f "${APP_DIR}/server/nest_study.sqlite" ]; then
  sudo -u "${SERVICE_USER}" NEST_DB_PATH="${APP_DIR}/server/nest_study.sqlite" \
    Rscript "${APP_DIR}/server/init_db.R" "${APP_DIR}/server/nest_study.sqlite"
else
  echo "  DB already exists -- leaving it alone"
fi

echo "== provision: installing systemd units =="
# render the service with the right paths (the shipped unit assumes /opt/nest-api)
install -m 644 "${SRC_DIR}/nest-api.service"         /etc/systemd/system/nest-api.service
systemctl daemon-reload
systemctl enable --now nest-api.service

# No nightly timer: the batch loads (scripts/db/nightly_load.R and
# schedule_load.R) run on a workstation, which is where the Sheets creds
# live. schedule_load.R pushes its results to this API.

echo "== provision: configuring Caddy =="
sed -e "s/nest\.example\.org/${DOMAIN}/g" \
    -e "s/admin@example\.org/${ACME_EMAIL}/g" \
    "${SRC_DIR}/Caddyfile" > /etc/caddy/Caddyfile
systemctl reload caddy || systemctl restart caddy

echo
echo "== provision: DONE =="
echo "API service:   systemctl status nest-api"
echo "Caddy:         systemctl status caddy   (HTTPS at https://${DOMAIN})"
echo
echo "NEXT -- mint the first API token(s):"
echo "  cd ${APP_DIR}/server"
echo "  sudo -u ${SERVICE_USER} NEST_DB_PATH=${APP_DIR}/server/nest_study.sqlite \\"
echo "    Rscript mint_token.R mint BSE \"Brian iPhone\""
echo "  # copy the printed token into the device; it is shown only once."
echo
echo "Smoke test:"
echo "  curl https://${DOMAIN}/healthz"
echo "  curl -H 'Authorization: Bearer <token>' https://${DOMAIN}/lookups"
