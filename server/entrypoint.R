#!/usr/bin/env Rscript

# entrypoint.R -----------------------------------------------------------

# Boots plumber.R on NEST_API_HOST:NEST_API_PORT (systemd sets these; see
# nest-api.service); Caddy proxies HTTPS to it.

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
