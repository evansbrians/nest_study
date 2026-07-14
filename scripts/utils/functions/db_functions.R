

# utility functions -------------------------------------------------------

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

# nest queries ------------------------------------------------------------

# Basic nest query:

nest_query <-
  function(.con = con) {
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

# Active "current" nests:

get_current_nests <-
  function(.con = con) {
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

# One nest's current status (discovery and most recent interval):

get_nest_status <-
  function(.con = con, .nest_id) {
    tbl(.con, "v_nest_latest_check") %>%
      filter(nest_id == .nest_id) %>%
      left_join(
        nest_query(.con),
        by = "nest_id"
      )
  }

# field_data bridge -------------------------------------------------------

# Rebuild the nested `nests` structure the workstation pipeline expects (one row
# per nest, its interval checks nested in `interval_data`) straight from the live
# database -- nests and interval checks now flow through the app, not the Google
# Sheet. Column names mirror the old sheet read so downstream consumers (the
# field map app, get_current_nests()) need no changes:

get_db_nests <-
  function(.con = con) {

    # Nest level: resolve the coded fields to labels and the shared point's name
    # (nests link to points by gps_point_id, never by name):

    nest_level <-
      tbl(.con, "nest") %>%
      left_join(
        tbl(.con, "species"),
        by = "species_code"
      ) %>%
      left_join(
        tbl(.con, "gps_point") %>%
          select(
            gps_point_id = point_id,
            gps_point = point_name
          ),
        by = "gps_point_id"
      ) %>%
      select(
        nest_id,
        patch_id,
        species = common_name,
        discovery_date,
        discovery_stage,
        selfie_stick,
        artificial_candidate,
        camera_or_control,
        camera_deployment_date,
        height = height_m,
        location_description,
        nest_fate,
        nest_fate_description,
        gps_point
      ) %>%
      collect()

    # Substrate is many-to-many; collapse each nest's plants to the same
    # comma-separated string the sheet and app used:

    nest_substrate <-
      tbl(.con, "nest_substrate") %>%
      left_join(
        tbl(.con, "substrate"),
        by = "substrate_id"
      ) %>%
      select(nest_id, label) %>%
      collect() %>%
      summarize(
        substrate = str_c(label, collapse = ", "),
        .by = nest_id
      )

    # Interval level: one row per check, named to match the old interval sheet:

    interval_level <-
      tbl(.con, "interval_check") %>%
      select(
        nest_id,
        date = check_date,
        time = check_time,
        current_state,
        observer = observer_id,
        adult_present,
        adult_activity,
        host_eggs,
        host_young,
        host_dead_young,
        bhco_eggs,
        bhco_young,
        bhco_dead_young,
        nest_status,
        young_status,
        notes
      ) %>%
      collect() %>%
      mutate(date = as_date(date))

    # Assemble: attach substrate, left-join the checks (a nest with no check yet
    # keeps one NA interval row, mirroring the old sheet join), then nest them:

    nest_level %>%
      left_join(nest_substrate, by = "nest_id") %>%
      relocate(substrate, .after = height) %>%
      left_join(interval_level, by = "nest_id") %>%
      nest(interval_data = date:notes)
  }

# Re-derive the per-class spatial files (data/spatial/<class>_locations.geojson)
# from the gps_point table -- points now come from the app/DB, not Google Drive.
# The workstation map, Google Earth, and print-out scripts read one geojson per
# point class keyed by `name`; a class that has lost all its points still gets an
# empty file so those downstream reads never error:

write_spatial_from_db <-
  function(.con = con, .dir = here::here("data/spatial")) {

    # The classes the downstream scripts expect a file for:

    classes <-
      c(
        "nest",
        "coverboard",
        "trailcam",
        "point_count",
        "landmark",
        "path_crossing",
        "boundary",
        "other"
      )

    # Every point, renamed to the old spatial-file columns:

    points <-
      tbl(.con, "gps_point") %>%
      select(
        point_id,
        name = point_name,
        point_class,
        datetime,
        elevation,
        bearing,
        accuracy = horizontal_accuracy,
        note,
        latitude,
        longitude
      ) %>%
      collect()

    # Write one geojson per class (empty classes get an empty, well-formed file):

    walk(
      classes,
      function(.class) {

        # Write path for this class:

        path <-
          str_c(.class, "_locations.geojson") %>%
          file.path(.dir, .)

        # This class's points as an sf object:

        class_points <-
          points %>%
          filter(point_class == .class) %>%
          select(!point_class)

        class_sf <-
          if (nrow(class_points) == 0) {
            st_sf(
              point_id = character(),
              name = character(),
              datetime = character(),
              elevation = double(),
              bearing = double(),
              accuracy = double(),
              note = character(),
              geometry = st_sfc(crs = 4326)
            )
          } else {
            class_points %>%
              st_as_sf(
                coords = c("longitude", "latitude"),
                crs = 4326
              )
          }

        st_write(
          class_sf,
          path,
          delete_dsn = TRUE,
          quiet = TRUE
        )
      }
    )
  }

# schedule ----------------------------------------------------------------

schedule <-
  function(.con = con, .week = NULL) {
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
  function(.con = con, .date) {
    nest_query(.con) %>%
      filter(discovery_date >= .date) %>%
      arrange(
        discovery_date,
        nest_id
      )
  }

# Interval checks recorded on or after a date:

checks_since <-
  function(.con = con, .date) {
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
  function(.con = con) {
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
