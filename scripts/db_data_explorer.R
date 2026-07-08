
# setup --------------------------------------------------------------------

library(DBI)
library(RSQLite)
library(dplyr)
library(dbplyr)
library(purrr)
library(tibble)

# connection ---------------------------------------------------------------

# Open a connection to the nest_study database:

connect_nest_db <-
  function(
    .db_path = 
      Sys.getenv(
        "NEST_DB_PATH", 
        unset = "nest_study.sqlite")
  ) {
    con <-
      dbConnect(
        RSQLite::SQLite(),
        .db_path
      )
    dbExecute(con, "PRAGMA foreign_keys = ON;")
    con
  }

# Note: To list tables in the DB use:

con <- connect_nest_db()

dbListTables(con)

# nest queries -------------------------------------------------------------

# Basic nest query:

nest_query <-
  function(.con) {
    tbl(.con, "nest") %>%
      left_join(
        tbl(.con, "species"),
        by = "species_code"
      ) %>%
      left_join(
        tbl(.con, "patch"),
        by = "patch_id"
      ) %>%
      arrange(nest_id)
  }

# current + status ---------------------------------------------------------

# Active "current" nests:

get_current_nests <-
  function(.con) {
    species_lookup <-
      tbl(.con, "nest") %>%
      left_join(
        tbl(.con, "species"),
        by = "species_code"
      ) %>%
      select(
        nest_id,
        species = common_name,
        discovery_date
      )
    
    tbl(.con, "v_current_nest") %>%
      left_join(
        species_lookup,
        by = "nest_id"
      ) %>%
      arrange(
        patch_id,
        nest_id
      )
  }

# One nest's current status (discovery and interval):

get_nest_status <-
  function(.con, .nest_id) {
    tbl(.con, "v_nest_latest_check") %>%
      filter(nest_id == .nest_id) %>%
      left_join(
        nest_query(.con),
        by = "nest_id"
      )
  }

# schedule -----------------------------------------------------------------

schedule <-
  function(.con, .week = NULL) {
    days <- tbl(.con, "schedule_day")

    if (!is.null(.week)) {
      days <-
        days %>%
        filter(week == .week)
    }
    
    days %>%
      select(
        week,
        date,
        day,
        arrive,
        patch_order,
        patch_count,
        boards,
        check_nests,
        predator_cameras,
        notes
      ) %>%
      arrange(
        date,
        patch_order
      ) %>%
      collect()
  }

# verification -------------------------------------------------------------

# Nests discovered on or after a date:

nests_since <-
  function(.con, .date) {
    nest_query(.con) %>%
      filter(discovery_date >= .date) %>%
      arrange(
        discovery_date,
        nest_id
      )
  }

# Interval checks recorded on or after a date:

checks_since <-
  function(.con, .date) {
    tbl(.con, "interval_check") %>%
      filter(check_date >= .date) %>%
      left_join(
        nest_query(.con),
        by = "nest_id"
      ) %>%
      arrange(
        check_date,
        nest_id
      )
  }

# Row counts for the core tables (a check to see if new data were added):

data_counts <-
  function(.con) {
    tables <-
      c(
        "nest",
        "interval_check",
        "gps_point",
        "nest_substrate",
        "track"
      )
    tibble(
      table = tables,
      rows =
        map_int(
          tables,
          function(.t) {
            tbl(.con, .t) %>%
              tally() %>%
              pull(n)
          }
        )
    )
  }
