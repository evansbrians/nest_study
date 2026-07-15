#!/usr/bin/env Rscript

# entrypoint.R --------------------------------------------------------------
# Boots the plumber API defined in plumber.R and serves it on a local port.
# Caddy reverse-proxies HTTPS -> this port (see Caddyfile).
#
# Env vars (systemd sets these; see nest-api.service):
#   NEST_DB_PATH     path to nest_study.sqlite   (default: ./nest_study.sqlite)
#   NEST_PHOTO_DIR   disk dir for photo files    (default: ./photos)
#   NEST_API_HOST    bind host                   (default: 127.0.0.1)
#   NEST_API_PORT    bind port                   (default: 8000)
#
# Bind to 127.0.0.1 so only Caddy (same host) can reach plumber directly.

suppressPackageStartupMessages({
  library(plumber)
  library(magrittr)
  library(stringr)
})

script_dir <-
  commandArgs(FALSE) %>%
  str_subset("^--file=") %>%
  str_remove("^--file=") %>%
  dirname()

if (length(script_dir) == 0 || script_dir == "") {
  script_dir <- "."
}

host <- Sys.getenv("NEST_API_HOST", unset = "127.0.0.1")
port_raw <- Sys.getenv("NEST_API_PORT", unset = "8000")
port <- as.integer(port_raw)

plumber_path <- file.path(script_dir, "plumber.R")
pr <- plumb(plumber_path)

message(
  "nest-api: serving on http://",
  host,
  ":",
  port
)

pr$run(
  host = host,
  port = port,
  docs = TRUE
)
