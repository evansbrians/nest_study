#!/usr/bin/env Rscript

# mint_token.R --------------------------------------------------------------
# Create (or revoke) a per-user API bearer token.
#
# The DB stores only the SHA-256 HASH of the token; the plaintext token is
# printed ONCE here -- copy it into the device now, it cannot be recovered.
#
# Mint:
#   Rscript mint_token.R mint <observer_id> "<label>"
#     e.g. Rscript mint_token.R mint BSE "Brian iPhone"
#   (creates the observer row if it does not exist)
#
# Revoke (lost/retired device):
#   Rscript mint_token.R revoke <token_hash>
#   (list hashes with:  Rscript mint_token.R list )
#
# List:
#   Rscript mint_token.R list

suppressPackageStartupMessages({
  library(DBI)
  library(RSQLite)
  library(digest)
  library(magrittr)
  library(stringr)
})

# helpers -------------------------------------------------------------------

now_utc <-
  function() {
    now_ct <-
      as.POSIXct(
        Sys.time(),
        tz = "UTC"
      )
    format(now_ct, "%Y-%m-%dT%H:%M:%SZ")
  }

# A random 32-byte token, hex-encoded.

new_token <-
  function() {
    0:255 %>%
      sample(32, replace = TRUE) %>%
      sprintf("%02x", .) %>%
      str_flatten()
  }

do_mint <-
  function(.args, .con) {
    if (length(.args) < 2) {
      stop("mint needs an observer_id")
    }
    observer_id <- .args[[2]]
    label <- if (length(.args) >= 3) .args[[3]] else NA

    # Ensure the observer exists.

    known <-
      dbGetQuery(
        .con,
        "SELECT 1 FROM observer WHERE observer_id = ?",
        params = list(observer_id)
      )
    if (nrow(known) == 0) {
      dbExecute(
        .con,
        "INSERT INTO observer (observer_id, full_name) VALUES (?, ?)",
        params = list(observer_id, NA)
      )
      message(
        "created observer ",
        observer_id,
        " (set full_name later)"
      )
    }

    token <- new_token()
    token_hash <-
      digest(
        token,
        algo = "sha256",
        serialize = FALSE
      )

    dbExecute(
      .con,
      "INSERT INTO api_token (token_hash, observer_id, label, created_at)
         VALUES (?, ?, ?, ?)",
      params = list(
        token_hash,
        observer_id,
        label,
        now_utc()
      )
    )

    cat("\n=== NEW TOKEN (copy now -- shown only once) ===\n")

    cat(
      "observer:",
      observer_id,
      "\n"
    )

    cat(
      "label:   ",
      if (is.na(label)) "(none)" else label,
      "\n"
    )

    cat(
      "token:   ",
      token,
      "\n"
    )

    cat(
      "hash:    ",
      token_hash,
      "\n"
    )

    cat(
      "Use as:  Authorization: Bearer",
      token,
      "\n\n"
    )
  }

do_revoke <-
  function(.args, .con) {
    if (length(.args) < 2) {
      stop("revoke needs a token_hash")
    }
    n <-
      dbExecute(
        .con,
        "UPDATE api_token SET revoked_at = ? WHERE token_hash = ?",
        params = list(now_utc(), .args[[2]])
      )
    message(
      "revoked ",
      n,
      " token(s)"
    )
  }

do_list <-
  function(.con) {
    dbGetQuery(
      .con,
      "SELECT token_hash, observer_id, label, created_at, revoked_at
         FROM api_token ORDER BY created_at"
    ) %>%
      print()
  }

# main ----------------------------------------------------------------------

db_path <- Sys.getenv("NEST_DB_PATH", unset = "nest_study.sqlite")
args <- commandArgs(trailingOnly = TRUE)

if (length(args) == 0) {
  stop("usage: mint_token.R [mint <observer_id> <label> | revoke <hash> | list]")
}

con <- dbConnect(RSQLite::SQLite(), db_path)
on.exit(dbDisconnect(con), add = TRUE)
dbExecute(con, "PRAGMA foreign_keys = ON;")

switch(
  args[[1]],
  mint = do_mint(args, con),
  revoke = do_revoke(args, con),
  list = do_list(con),
  stop("unknown command: ", args[[1]])
)
