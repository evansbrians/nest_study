# Functions for schedule updates

# functions for app version *and* pdf -------------------------------------

## combine Google sheets and initial scheduling data ----------------------

get_modify_schedule <-
  function(
    .week = get_sampling_week(),
    .week_offset = 19,
    .schedule_url = here::here("data/season_schedule.rds")
  ) {
    
    # The schedule for the week as defined during the pre-field season:
    
    schedule_start <-
      read_rds(.schedule_url) %>% 
      filter(week == .week) %>% 
      select(
        !c(week, helper)
      ) %>% 
      arrange(date) %>% 
      
      # Unnest patch counts to define patch search order:
      
      unnest(patch_counts, keep_empty = TRUE) %>% 
      mutate(
        search_patch_1 = patch_count[patch_order == 3],
        search_patch_2 = patch_count[patch_order == 2],
        .by = date
      ) %>% 
      
      # Boards sampled per patch:
      
      unnest(boards, keep_empty = TRUE) %>% 
      summarize(
        boards = str_flatten(board_id, collapse = ", "),
        .by = !board_id
      ) %>% 
      
      # Seed the GUI-owned weekly layer with defaults. Tara maintains helper,
      # field day, search-patch overrides, tasks, notes and departure/point-count
      # times live in the GUI; the loader no longer reads a Google Sheet for
      # them, and POST /schedule upserts only the derived columns, so these
      # defaults apply only when a brand-new week is first seeded. The weather-day
      # shift now runs client-side (snedgen-gui + nest_app_api), replacing the old
      # R-side activity offset.

      mutate(
        helper = "-",
        field = TRUE,
        notes = NA_character_,
        helper_patch_1 = NA_character_,
        tns_patch_1 = NA_character_,
        helper_patch_2 = NA_character_,
        tns_patch_2 = NA_character_,
        departure_time = NA_character_,
        scbi_departure_time = NA_character_,
        point_count_time = NA_character_
      ) %>%
      select(
        date:day,
        helper,
        everything()
      )
  }

## define current nests ---------------------------------------------------

get_current_nests <-
  function(
    .nests =
      {
        .con <- connect_nest_db()
        on.exit(dbDisconnect(.con), add = TRUE)
        get_db_nests(.con)
      },
    .reference_date = today()
  ) {

    # Process nest data and determine the earliest next nest check:

    .nests %>%
      unnest(interval_data) %>%
      mutate(
        
        # It's probably safest to turn the NA values into 0s:
        
        across(
          host_eggs:host_young,
          ~ replace_na(.x, 0)
        ),
        
        # Reference date as a date object:
        
        reference_date = as_date(.reference_date)
      ) %>% 
      
      # Filter to observations before or on the reference date:
      
      filter(
        date <= reference_date
      ) %>% 
      
      # Determine the number of days with 0 eggs and 0 young:
      
      summarize_me(
        first_check = min(date),
        last_check = max(date),
        n_checks = n_unique(date),
        n_check_days = 
          as.numeric(last_check - first_check),
        always_empty = sum(host_eggs, host_young) == 0,
        selfie_stick = max(selfie_stick),
        .by = 
          vars(
            nest_id,
            patch = patch_id,
            nest_fate,
            reference_date
          )
      ) %>%
      
      # Check if the fate is NA, the number of check days is less than or equal
      # to 10, and it's been empty at every check:
      
      filter(
        is.na(nest_fate),
        reference_date - last_check <= 14,
        !(n_check_days > 10 & always_empty)
      )
  }

## add current nests to the schedule --------------------------------------

add_nests_to_schedule <-
  function(
    .schedule,
    .current_nests = get_current_nests(),
    .mark_tall_nests = TRUE
  ) {

    nest_summary <-
      .current_nests %>%

      # Define nests as requiring a selfie-stick (app only):

      {
        if (.mark_tall_nests) {
          mutate(
            .,

            # Add giraffes:

            nest_id =
              if_else(
                selfie_stick == 1,
                str_c(nest_id, "\U1F992"),
                nest_id
              )
          )
        } else .
      } %>%

      # Nests by patch:

      summarize(
        check_nests = str_flatten(nest_id, collapse = ", "),
        .by = patch
      )

    # Add the nests to the schedule:

    left_join(
      .schedule,
      nest_summary,
      by = join_by(patch_count == patch)
    )
  }

## predator camera maintenance schedule -----------------------------------

schedule_camera_maintenance <-
  function(
    .schedule,
    .week = get_sampling_week(),
    .db_path =
      Sys.getenv(
        "NEST_DB_PATH",
        here::here("data", "nest_study.sqlite"))
  ) {

    # Camera maintenance history now lives in the DB (camera_maintenance),
    # refreshed from the VM before the schedule build. This replaces the old
    # googlesheets4::read_sheet() of the predator-camera sheet.

    con <-
      DBI::dbConnect(
        RSQLite::SQLite(),
        .db_path
      )

    trail_cams <-
      DBI::dbGetQuery(
        con,
        "SELECT camera_id, event_date, install, replace_sd, replace_batteries
           FROM camera_maintenance"
      ) %>%
      as_tibble() %>%
      transmute(
        camera_id,
        date = as_date(event_date),
        install = as.logical(install),
        replace_sd = as.logical(replace_sd),
        replace_batteries = as.logical(replace_batteries)
      ) %>%
      
      # Subset to the last time in which any maintenance activity occurred:
      
      filter(
        when_any(install, replace_sd & replace_batteries),
      ) %>% 
      
      # Summarize by patch and camera (see functions.R):
      
      summarize_me(
        date = max(date) + 21,
        .by = 
          vars(
            patch_count = str_remove(camera_id, "_trailcam_[0-2]"),
            camera_id
          )
      ) %>% 
      
      # Subset to cameras that need to be sampled in the next week:
      
      filter(
        get_sampling_week(date) <= .week
      ) %>% 
      
      # Get the two cameras that are most in need of maintenance in each patch:
      
      slice_min(
        date,
        n = 2,
        with_ties = FALSE,
        by = patch_count
      ) %>% 
      
      # Assign camera priority:
      
      mutate(
        priority = row_number(),
        .by = patch_count
      ) %>%
      select(!date)

    DBI::dbDisconnect(con)

    # Add camera maintenance:
    
    if (nrow(trail_cams) == 0) {
      .schedule %>% 
        mutate(predator_cameras = "-")
    } else {
      .schedule %>% 
        arrange(patch_count, date) %>% 
        mutate(
          visit = row_number(),
          .by = patch_count
        ) %>% 
        left_join(
          trail_cams,
          by = join_by(patch_count, visit == priority)
        ) %>% 
        select(!visit) %>% 
        mutate(
          predator_cameras = str_extract(camera_id, "[0-2]$")
        ) %>% 
        arrange(date, patch_order)
    }
  }

## output schedule --------------------------------------------------------

# Order of operations can matter here:

# get_sampling_week("2026-07-05") %>% 
#   get_modify_schedule() %>%
#   add_nests_to_schedule() %>%
#   schedule_camera_maintenance() %>%
#   make_pretty_schedule()

# Function for the final output for the app and pdf:

make_pretty_schedule <-
  function(.activity_schedule) {
    
    # Define scheduling variables, in output format:
    
    .activity_schedule %>% 
      mutate(
        departure_time = 
          make_pretty_time(
            arrive, 
            .offset = minutes(-45)
          ),
        scbi_departure_time = 
          make_pretty_time(
            arrive, 
            .offset = hours(9)
          ),
        point_count_time = 
          make_pretty_time(
            sunrise, 
            .offset = minutes(40 * (patch_order - 1))
          ),
        across(
          c(check_nests, predator_cameras),
          ~ replace_na(as.character(.x), "-")
        )
      )
  }

## season schedule to a joined per-day data frame -------------------------

# Target date for the schedule. dashboard.R exports REFERENCE_DATE (today() for
# daily updates, today() + 1 on Sunday evenings to roll into the coming week);
# unset falls back to today(). Read here so the choice travels across the
# quarto_render() process boundary that generates the app and PDF.

get_target_date <-
  function(.env_date = Sys.getenv("REFERENCE_DATE")) {
    if (nzchar(.env_date)) as_date(.env_date) else today()
  }

# Runs the modular pipeline (get_modify_schedule -> add_nests_to_schedule ->
# schedule_camera_maintenance -> make_pretty_schedule) end to end for the app
# and PDF. Use .mark_tall_nests = FALSE for the PDF version. A single
# .target_date drives both the sampling week and the current-nest reference.

prep_schedule_data <-
  function(
    .target_date = get_target_date(),
    .week_offset = 19,
    .week = get_sampling_week(.target_date, .week_offset),
    .schedule_url = here::here("data/season_schedule.rds"),
    .reference_date = .target_date,
    .mark_tall_nests = TRUE # FALSE for the PDF version
  ) {
      get_modify_schedule(
        .week = .week,
        .week_offset = .week_offset,
        .schedule_url = .schedule_url
      ) %>%
      add_nests_to_schedule(
        .current_nests =
          get_current_nests(
            .reference_date = .reference_date
          ),
        .mark_tall_nests = .mark_tall_nests
      ) %>%
      schedule_camera_maintenance(
        .week = .week
      ) %>%
      make_pretty_schedule()
  }

# Blank or missing values become a dash:

dash_blank <-
  function(.x) {
    if (is_valid_value(.x)) {
      str_trim(.x)
    } else {
      "-"
    } 
  }

# functions for the pdf version -------------------------------------------

# The functions below are only used in the pdf version.

## style for tabular output -----------------------------------------------

my_kable_style <-
  function(.kable) {
    .kable %>% 
      kable_styling(
        latex_options = 
          c(
            "hold_position"
          ),
        full_width = FALSE,
        position = "left",
        font_size = 10
      )
  }

## departure, arrival, and sunrise table ----------------------------------

morning_times <-
  function(.rows) {
    .rows %>%
      distinct(
        Departure = departure_time,
        Arrival = arrive, 
        Sunrise = sunrise
      ) %>% 
      kable(
        align = 
          c("c", "c", "c")
      ) %>% 
      my_kable_style() %>% 
      column_spec(1:3, width = "14.5em") %>% 
      as.character()
  }

## point counts and coverboards for a given day ---------------------------

pred_counts <-
  function(.rows) {
    .rows %>%
      select(
        Time = point_count_time,
        Patch = patch_count,
        Coverboards = boards,
        `Check nests` = check_nests,
        `Predator cameras` = predator_cameras
      ) %>% 
      kable(
        booktabs = TRUE,
        align =
          c(
            "c",
            "l",
            "c",
            "l"
          )
      ) %>% 
      my_kable_style() %>% 
      column_spec(1, width = "2.5em") %>% 
      column_spec(2, width = "7em") %>% 
      column_spec(3, width = "5em") %>% 
      column_spec(4, width = "14.5em") %>% 
      column_spec(5, width = "12em") %>% 
      as.character()
  }

## helper, morning times, and pred counts for a day -----------------------

day_details <-
  function(
    .wday,
    .helper = "-",
    .schedule_list = schedule_list
  ) {
    day_rows <-
      pluck(.schedule_list, .wday)
    
    day_date <-
      day_rows %>%
      pull(date) %>%
      first()
    
    str_c(
      "\n## ", wday(day_date, label = TRUE, abbr = FALSE), " ",
      make_pretty_dates(day_date), "\n\n",
      "*Helper: ", .helper, "*",
      "\\vspace{0em}",
      morning_times(day_rows),
      "**Point count times, coverboards, and nests to check**:",
      "\\vspace{0em}",
      pred_counts(day_rows),
      "\\vspace{0em}"
    ) %>%
      cat()
  }

## nest searching order ---------------------------------------------------

nest_searching_order <- 
  function(.patches) {
    str_c(
      "**Nest searching**: ", 
      str_flatten(.patches, collapse = " → ")
    ) %>%
      cat()
  }

## nest searching activity details ----------------------------------------

nest_searching <- 
  function(
    .helper,
    .patches,
    .helper_patch_1 = "-",
    .me_patch_1 = "-",
    .helper_patch_2 = "-",
    .me_patch_2 = "-"
  ) {
    start <- 
      tibble(
        helper = .helper,
        patch_count = .patches
      ) %>% 
      mutate(
        patch_count =
          factor(
            patch_count,
            levels = 
              patch_count
          )
      )
    
    crossing(
      Patch = start$patch_count,
      Person = 
        c(
          "TNS",
          pull(start, unique(helper))
        )
    ) %>% 
      mutate(
        Activities = 
          c(
            .helper_patch_1,
            .me_patch_1,
            .helper_patch_2,
            .me_patch_2
          )
      ) %>% 
      filter(
        Person != "-"
      ) %>% 
      kable() %>% 
      my_kable_style() %>%
      collapse_rows(
        columns = 1
      ) %>% 
      column_spec(1, width = "8em") %>% 
      column_spec(2, width = "5em") %>% 
      column_spec(3, width = "30.5em") %>% 
      as.character() %>%
      cat()
  }

## note for additional details (outside of tables) ------------------------

note <- 
  function(.note) {
    str_c(
      "*Note: ",
      .note,
      "*",
      "\n\n",
      "\\vspace{1em}"
    ) %>%
      cat()
  }

## get day block data -----------------------------------------------------

# This uses the original schedule and updates with the Google sheet.





## full day block, driven by prep_schedule_data --------------------------

day_block <-
  function(
    .wday,
    .schedule_list = schedule_list
  ) {
    
    # This weekday's row (schedule fields already merged with the Google
    # Sheet in prep_schedule_data):
    
    row <-
      .schedule_list %>%
      pluck(.wday) %>%
      slice(1)
    
    # Pull one sheet value (a dash when blank or absent):
    
    sheet_val <-
      function(.col) {
        dash_blank(row[[.col]])
      }
    
    helper <- sheet_val("helper")
    notes <- sheet_val("notes")
    
    # Searching patches (base order, already overridden by the sheet in prep):
    
    search_patches <-
      c(
        sheet_val("search_patch_1"),
        sheet_val("search_patch_2")
      ) %>%
      keep(~ .x != "-")
    
    # Morning times and point counts:
    
    day_details(
      .wday,
      helper,
      .schedule_list
    )
    
    # Notes (only when the sheet has them):
    
    if (notes != "-") {
      note(notes)
    }
    
    # Nest searching order and activity table (helper and activities from
    # sheet):
    
    nest_searching_order(.patches = search_patches)
    
    nest_searching(
      .helper = helper,
      .patches = search_patches,
      .helper_patch_1 = sheet_val("helper_patch_1"),
      .me_patch_1 = sheet_val("tns_patch_1"),
      .helper_patch_2 = sheet_val("helper_patch_2"),
      .me_patch_2 = sheet_val("tns_patch_2")
    )
  }
