
# Bulk-insert the matched nest photos through the REST API, one POST per photo,
# skipping anything the server already holds.

# setup -------------------------------------------------------------------

library(cli)
library(httr)
library(jsonlite)
library(tidyverse)

source(here::here("scripts/utils/functions/db_functions.R"))

base_url <- "https://snednestudy.duckdns.org"

# The token is personal and this script is public, so it is read from the R
# environment rather than written here.

token <- Sys.getenv("NEST_API_TOKEN")

if (!nzchar(token)) {
  cli_abort(
    c(
      "NEST_API_TOKEN is not set.",
      "i" =
        "Run usethis::edit_r_environ(), add a line reading
         NEST_API_TOKEN=your_token, then restart R.",
      "i" =
        "The project .Renviron is gitignored, so the token is safe there."
    )
  )
}

auth <-
  add_headers(
    Authorization =
      str_c("Bearer ", token),
    Accept =
      "application/json"
  )

# settings ----------------------------------------------------------------

matches_path <-
  here::here("data/photos/photo_nest_matches.csv")

receipt_path <-
  here::here("data/photos/photo_upload_receipt.csv")

# The photo.kind these bulk rows are filed under. The field app and the GUI
# resolve 'original' and 'inside_nest', so this keeps bulk rows out of both.

photo_kind <- "nest_interior"

# Photos with an ambiguous nearest nest wait for a human. Set to TRUE to send
# them once the notes column has been checked.

upload_flagged <- FALSE

# build the queue ---------------------------------------------------------

# An empty result has no columns at all, so the filename vector is built
# defensively rather than pulled.

existing_photos <-
  str_c("photos?kind=", photo_kind) %>%
  query_api()

existing_files <-
  if ("filename" %in% names(existing_photos)) {
    existing_photos$filename
  } else {
    character()
  }

photo_matches <-
  matches_path %>%
  read_csv(show_col_types = FALSE)

photo_queue <-
  photo_matches %>%
  filter(
    !is.na(nest_id),
    !file_name %in% existing_files
  )

if (!upload_flagged) {
  held_back <-
    photo_queue %>%
    filter(distance_flag)

  if (nrow(held_back) > 0) {
    cli_alert_warning(
      "Holding back {nrow(held_back)} flagged photo{?s}; set upload_flagged to
       TRUE once the notes column has been checked."
    )
  }

  photo_queue <-
    photo_queue %>%
    filter(!distance_flag)
}

absent_files <-
  photo_queue %>%
  filter(
    !file.exists(file_path)
  )

if (nrow(absent_files) > 0) {
  cli_abort(
    "{nrow(absent_files)} file{?s} in the match table {?is/are} missing from
     disk -- re-run export_photos.sh."
  )
}

if (nrow(photo_queue) == 0) {
  cli_alert_info(
    "Nothing to upload: every matched photo is already on the server."
  )
}

# upload ------------------------------------------------------------------

# The receipt's shape is declared up front so an empty queue still yields a
# well-formed table for the report below.

receipt_prototype <-
  tibble(
    photo_id = character(),
    file_name = character(),
    nest_id = character(),
    status = integer(),
    db_photo_id = integer(),
    replayed = logical(),
    message = character()
  )

progress_id <-
  cli_progress_bar(
    "Uploading photos",
    total = nrow(photo_queue)
  )

# .photo_id carries the source file's content hash, so re-running this script
# replays the earlier write instead of inserting a duplicate row.

post_photo <-
  function(
    .photo_id,
    .file_path,
    .file_name,
    .nest_id,
    .point_id,
    .bearing,
    .taken_at
  ) {
    payload <-
      list(
        kind = photo_kind,
        nest_id = .nest_id,
        point_id = .point_id,
        bearing = .bearing,
        filename = .file_name,
        ext = "avif",
        taken_at = .taken_at,
        image =
          .file_path %>%
          read_file_raw() %>%
          base64_enc()
      ) %>%
      discard(is.na)

    response <-
      tryCatch(
        str_c(base_url, "/photos") %>%
          POST(
            config = auth,
            add_headers(
              `X-Idempotency-Key` =
                str_c("bulk_", .photo_id)
            ),
            body = payload,
            encode = "json"
          ),
        error = function(.e) .e
      )

    cli_progress_update(id = progress_id)

    if (inherits(response, "error")) {
      return(
        tibble(
          photo_id = .photo_id,
          file_name = .file_name,
          nest_id = .nest_id,
          status = NA_integer_,
          db_photo_id = NA_integer_,
          replayed = NA,
          message = conditionMessage(response)
        )
      )
    }

    # A 5xx from the proxy comes back as html, so a failed parse must not take
    # the whole batch down with it.

    parsed <-
      tryCatch(
        response %>%
          content(
            as = "text",
            encoding = "UTF-8"
          ) %>%
          fromJSON(flatten = TRUE),
        error = function(.e) list()
      )

    tibble(
      photo_id = .photo_id,
      file_name = .file_name,
      nest_id = .nest_id,
      status = status_code(response),
      db_photo_id =
        parsed %>%
        pluck(
          "photo",
          "photo_id",
          .default = NA_integer_
        ) %>%
        as.integer(),
      replayed =
        parsed %>%
        pluck(
          "replayed",
          .default = FALSE
        ),
      message =
        parsed %>%
        pluck(
          "error",
          .default = NA_character_
        )
    )
  }

upload_results <-
  photo_queue %>%
  select(
    .photo_id = photo_id,
    .file_path = file_path,
    .file_name = file_name,
    .nest_id = nest_id,
    .point_id = point_id,
    .bearing = bearing,
    .taken_at = taken_at
  ) %>%
  pmap(post_photo) %>%
  list_rbind(ptype = receipt_prototype)

cli_progress_done(id = progress_id)

# report ------------------------------------------------------------------

failed_uploads <-
  upload_results %>%
  filter(
    is.na(status) | status != 201
  )

upload_results %>%
  write_csv(receipt_path)

cli_alert_success(
  "Uploaded {nrow(upload_results) - nrow(failed_uploads)} photo{?s} as kind
   '{photo_kind}'."
)

if (nrow(failed_uploads) > 0) {
  cli_alert_danger("{nrow(failed_uploads)} upload{?s} failed:")
  cli_ul(
    str_glue_data(
      failed_uploads,
      "{file_name} -> HTTP {status}: {message}"
    )
  )
}

cli_alert_info("Receipt written to {.path {receipt_path}}.")
