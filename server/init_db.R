#!/usr/bin/env Rscript

# init_db.R -----------------------------------------------------------------
# Creates (or re-initializes) nest_study.sqlite by applying ../schema.sql then
# ../seed.sql, and sets the pragmas the API relies on (foreign_keys, WAL).
#
# Idempotency note:
#   schema.sql uses plain CREATE TABLE (no IF NOT EXISTS), so running this
#   against a database that already has the schema will ERROR on the first
#   CREATE. That is intentional -- it stops you clobbering a live DB by
#   accident. To rebuild from scratch, delete the file first:
#
#     rm -f nest_study.sqlite nest_study.sqlite-wal nest_study.sqlite-shm
#     Rscript init_db.R
#
#   The seed inserts are plain INSERTs too; re-seeding an already-seeded DB
#   would hit PRIMARY KEY collisions. So: fresh file in, fully seeded DB out.
#
# Usage:
#   Rscript init_db.R [db_path]           # default: ./nest_study.sqlite

suppressPackageStartupMessages({
  library(DBI)
  library(RSQLite)
  library(readr)
  library(stringr)
  library(purrr)
  library(dplyr)
})

# command-line args and this script's directory ----------------------------

args <- commandArgs(trailingOnly = TRUE)

script_dir <-
  commandArgs(FALSE) %>%
  str_subset("^--file=") %>%
  str_remove("^--file=") %>%
  dirname()

if (length(script_dir) == 0 || script_dir == "") {
  script_dir <- "."
}

db_path <-
  if (length(args) >= 1) {
    args[[1]]
  } else {
    file.path(script_dir, "nest_study.sqlite")
  }

schema_path <-
  file.path(
    script_dir,
    "..",
    "schema.sql"
  ) %>%
  normalizePath(mustWork = TRUE)

seed_path <-
  file.path(
    script_dir,
    "..",
    "seed.sql"
  ) %>%
  normalizePath(mustWork = TRUE)

message("init_db: creating ", db_path)
message("  schema: ", schema_path)
message("  seed:   ", seed_path)

# run a whole .sql file, statement by statement ----------------------------

# SQLite's DBI driver runs one statement per dbExecute(), so we split on
# semicolons. Line comments are stripped FIRST, so a ';' inside a comment (e.g.
# an example value) is never mistaken for a statement terminator. schema.sql /
# seed.sql have no ';' or '--' inside string literals, so this is safe.

run_sql_file <-
  function(.con, .path) {
    read_file(.path) %>%
      str_remove_all("--[^\n]*") %>%
      str_split_1(";\\s*(\\n|$)") %>%
      str_trim() %>%
      keep(nzchar) %>%
      walk(
        ~ dbExecute(.con, .x)
      )
  }

# build the database --------------------------------------------------------

con <- dbConnect(RSQLite::SQLite(), db_path)
on.exit(dbDisconnect(con), add = TRUE)

# WAL survives across connections; foreign_keys is per-connection, so the API
# sets it again on each connect.

invisible(dbExecute(con, "PRAGMA journal_mode = WAL;"))
invisible(dbExecute(con, "PRAGMA foreign_keys = ON;"))

invisible(
  dbWithTransaction(
    con,
    run_sql_file(con, schema_path)
  )
)

invisible(
  dbWithTransaction(
    con,
    run_sql_file(con, seed_path)
  )
)

# report --------------------------------------------------------------------

n_tables <-
  con %>%
  dbGetQuery("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'") %>%
  pull(n)

n_species <-
  con %>%
  dbGetQuery("SELECT count(*) AS n FROM species") %>%
  pull(n)

message(
  "init_db: done. tables = ",
  n_tables,
  ", species seeded = ",
  n_species
)
message("Next: mint an api_token (see server/README.md), then start the API.")
