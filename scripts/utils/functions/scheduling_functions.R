# Functions for schedule updates

# functions for app version *and* pdf -------------------------------------

## combine Google sheets and initial scheduling data ----------------------

get_modify_schedule <-
  function(
    .week = get_sampling_week(),
    .week_offset = 19,
    .gsheet_id = "1Pt-PPSekVv4BIM7nhCHPw1cmnUWkfrbjWpGw79-ohiQ",
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
      
      # Nest everything but visit-level variables:
      
      nest(activities = !date:sunrise)
    
    # ... and ensure that everything is in date order
    
    # Get and process the the Google Sheets schedule for the week:
    
    g_sheet <-
      file.path("https://docs.google.com/spreadsheets/d", .gsheet_id) %>% 
      googlesheets4::read_sheet() %>% 
      mutate(
        date = as_date(date),
        field = as.logical(field)
      ) %>% 
      filter(
        get_sampling_week(date, .week_offset) == .week
      )
    
    # Determine if there is a day cancelled for weather an pull it:
    
    weather_day <-
      g_sheet %>% 
      filter(
        !field,
        day != "Sun"
      ) %>% 
      pull(date)
    
    # Offset for a day cancelled due to weather, if necessary:
    
    schedule_augmented <-
      schedule_start %>%
      unnest(activities, keep_empty = TRUE)

    if (length(weather_day) > 0) {
      schedule_augmented <-
        schedule_start %>% 
        
        # Make sure the data are date-arranged: 
        
        arrange(date) %>% 
        mutate(
          activities =
            case_when(
              date > weather_day ~ lag(activities),
              .default = activities
            )
        ) %>% 
        unnest(activities, keep_empty = TRUE)
    }
    
    # Add the information from the Google Sheet schedule:
    
    schedule_augmented %>%  
      left_join(
        g_sheet %>% 
          select(!day) %>% 
          rename(
            sp_1 = search_patch_1,
            sp_2 = search_patch_2
          ),
        by = "date"
      ) %>% 
      
      # Replace schedule info with custom inputs from Google Sheets, if
      # necessary:
      
      mutate(
        search_patch_1 = 
          if_else(
            is.na(sp_1),
            search_patch_1,
            sp_1
          ),
        search_patch_2 = 
          if_else(
            is.na(sp_2),
            search_patch_2,
            sp_2
          ),
        helper = replace_na(helper, "-"),
        .keep = "unused"
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
    .field_data = here::here("data/field_data.rds"),
    .nests =
      read_rds(.field_data) %>%
      pluck("nests"),
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
    .predator_cam_id = "1exlfw40PfefcOLRxf7WUyCi9TOJ3yydKbAXcJNmABfc",
    .week = get_sampling_week()
  ) {
    
    trail_cams <-
      file.path("https://docs.google.com/spreadsheets/d", .predator_cam_id) %>% 
      googlesheets4::read_sheet() %>% 
      mutate(
        date = as_date(date),
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

prep_schedule_data <-
  function(
    .week = get_sampling_week(),
    .week_offset = 19,
    .gsheet_id = "1Pt-PPSekVv4BIM7nhCHPw1cmnUWkfrbjWpGw79-ohiQ",
    .schedule_url = here::here("data/season_schedule.rds"),
    .field_data = here::here("data/field_data.rds"),
    .predator_cam_id = "1exlfw40PfefcOLRxf7WUyCi9TOJ3yydKbAXcJNmABfc",
    .mark_tall_nests = TRUE
  ) {
    
    ## base schedule ------------------------------------------------------
    
    schedule_start <-
      read_rds(.schedule_url) %>% 
      filter_me(week == .week) %>% 
      select(!helper) %>% 
      arrange(date) %>% 
      
      # Define starting patch order (can be modified in Google Sheets):
      
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
      )
    
    ## nest checks --------------------------------------------------------
    
    # Define current nests:
    
    nests_to_check <-
      read_rds(.field_data) %>% 
      pluck("nests") %>% 
      
      # Process nest data and determine the earliest next nest check:
      
      unnest(interval_data) %>%
      
      # It's probably safest to turn the NA values into 0s:
      
      mutate(
        across(
          host_eggs:host_young,
          ~ replace_na(.x, 0)
        )
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
            nest_fate
          )
      ) %>%
      
      # Check if the fate is NA, the number of check days is less than or equal
      # to 10, and it's been empty at every check:
      
      filter(
        is.na(nest_fate),
        !(n_check_days > 10 & always_empty)
      ) %>% 
      
      # Add giraffes (app only):
      
      {
        if(.mark_tall_nests) {
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
    
    # Add nests to the schedule:
    
    schedule_with_nests <-
      schedule_start %>% 
      left_join(
        nests_to_check,
        by = join_by(patch_count == patch)
      )
    
    ## predator cameras ---------------------------------------------------
    
    predator_cameras <-
      file.path("https://docs.google.com/spreadsheets/d", .predator_cam_id) %>% 
      googlesheets4::read_sheet() %>% 
      mutate(
        date = as_date(date),
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
    
    # Add camera maintenance:
    
    if (nrow(predator_cameras) == 0) {
      schedule_with_cameras <-
        schedule_with_nests %>% 
        mutate(predator_cameras = NA)
    } else {
      schedule_with_cameras <-
        schedule_with_nests %>% 
        arrange(patch_count, date) %>% 
        mutate(
          visit = row_number(),
          .by = patch_count
        ) %>% 
        left_join(
          predator_cameras,
          by = join_by(patch_count, visit == priority)
        ) %>% 
        select(!visit) %>% 
        mutate(
          predator_cameras = str_extract(camera_id, "[0-2]$")
        ) %>% 
        arrange(date, patch_order)
    }
    
    ## update scheduling info ---------------------------------------------
    
    # Get and process the the Google Sheets schedule for .week:
    
    g_sheet <-
      file.path("https://docs.google.com/spreadsheets/d", .gsheet_id) %>% 
      googlesheets4::read_sheet() %>% 
      mutate(
        date = as_date(date),
        field = as.logical(field)
      ) %>% 
      filter(
        get_sampling_week(date, .week_offset) == .week
      )
    
    # Determine if there is a day cancelled for weather an pull it:
    
    weather_day <-
      g_sheet %>% 
      filter(
        !field,
        day != "Sun"
      ) %>% 
      pull(date)
    
    # Potentially offset scheduling by a weather day:
    
    schedule_augmented <- schedule_with_cameras
    
    if (length(weather_day) > 0) {
      schedule_augmented <-
        schedule_with_cameras %>% 
        arrange(date) %>% 
        nest(activities = !date:sunrise) %>% 
        mutate(
          activities =
            case_when(
              date > weather_day ~ lag(activities),
              .default = activities
            )
        ) %>% 
        unnest(activities, keep_empty = TRUE)
    }
    
    # Add the information from the Google Sheet schedule:
    
    schedule_augmented %>%  
      left_join(
        g_sheet %>% 
          select(!day) %>% 
          rename(
            sp_1 = search_patch_1,
            sp_2 = search_patch_2
          ),
        by = "date"
      ) %>% 
      
      # Replace schedule info with custom inputs from Google Sheets, if
      # necessary:
      
      mutate(
        search_patch_1 = 
          if_else(
            is.na(sp_1),
            search_patch_1,
            sp_1
          ),
        search_patch_2 = 
          if_else(
            is.na(sp_2),
            search_patch_2,
            sp_2
          ),
        helper = replace_na(helper, "-"),
        .keep = "unused"
      ) %>% 
      select(
        date:day,
        helper,
        everything()
      ) %>% 
      
      # Define other scheduling variables, in output format:
      
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

# Blank or missing values become a dash:

dash_blank <-
  function(.x) {
    if (is_valid_value(.x)) {
      str_trim(.x)
    } else {
      "-"
    } 
  }

# functions for the app version -------------------------------------------

# The functions below are only used in the app version.

## mobile-app schedule tables (htmltools) ---------------------------------

# Home departure, arrival, sunrise and SCBI departure table:

morning_times_table <-
  function(.rows) {
    if (!is_valid_frame(.rows)) return(NULL)
    .rows <- slice(.rows, 1)
    tags$table(
      class = "schedule-table morning-table",
      tags$thead(
        tags$tr(
          tags$th("Home departure"),
          tags$th("Arrival"),
          tags$th("Sunrise"),
          tags$th("SCBI departure")
        )
      ),
      tags$tbody(
        tags$tr(
          tags$td(
            dash_blank(.rows$departure_time)
          ),
          tags$td(
            dash_blank(.rows$arrive)
          ),
          tags$td(
            dash_blank(.rows$sunrise)
          ),
          tags$td(
            dash_blank(.rows$scbi_departure_time)
          )
        )
      )
    )
  }

# Point count times, coverboards, nests to check and predator cameras table:

pred_counts_table <-
  function(.rows) {
    if (!is_valid_frame(.rows)) return(NULL)
    .rows <- arrange(.rows, patch_order)
    tags$table(
      class = "schedule-table",
      tags$thead(
        tags$tr(
          tags$th("Time"),
          tags$th("Patch"),
          tags$th("Boards"),
          tags$th("Nests"),
          tags$th("Cams")
        )
      ),
      tags$tbody(
        seq_len(
          nrow(.rows)
        ) %>%
          map(
            function(.i) {
              tags$tr(
                tags$td(.rows$point_count_time[[.i]]),
                tags$td(
                  pretty_patch(
                    as.character(.rows$patch_count[[.i]])
                  )
                ),
                tags$td(.rows$boards[[.i]]),
                tags$td(.rows$check_nests[[.i]]),
                tags$td(.rows$predator_cameras[[.i]])
              )
            }
          )
      )
    )
  }

# Patch / Person / Activities table for a single day:

searching_table <-
  function(.patches, .helper, .tns, .help) {
    has_helper <- dash_blank(.helper) != "-"
    rows <-
      seq_along(.patches) %>%
      map(
        function(.i) {
          patch_cell <-
            tags$td(
              class = "sched-patch",
              rowspan = if (has_helper) "2" else "1",
              pretty_patch(
                as.character(.patches[[.i]])
              )
            )
          if (has_helper) {
            tagList(
              tags$tr(
                patch_cell,
                tags$td("TNS"),
                tags$td(
                  dash_blank(.tns[[.i]])
                )
              ),
              tags$tr(
                tags$td(
                  dash_blank(.helper)
                ),
                tags$td(
                  dash_blank(.help[[.i]])
                )
              )
            )
          } else {
            tags$tr(
              patch_cell,
              tags$td("TNS"),
              tags$td(
                dash_blank(.tns[[.i]])
              )
            )
          }
        }
      )
    tags$table(
      class = "schedule-table",
      tags$thead(
        tags$tr(
          tags$th("Patch"),
          tags$th("Person"),
          tags$th("Activities")
        )
      ),
      tags$tbody(rows)
    )
  }

# Notes cell to a bulleted list:

note_list <-
  function(.notes) {
    if (!is_valid_value(.notes)) return(NULL)
    items <-
      str_split(.notes, "\n")[[1]] %>%
      str_trim() %>%
      keep(~ .x != "") %>%
      map(
        ~ tags$li(.x)
      )
    tagList(
      tags$p(
        tags$strong("Notes:")
      ),
      tags$ul(
        class = "schedule-notes",
        items
      )
    )
  }

## weather ----------------------------------------------------------------

# Weather summary and hourly forecast for a single day:

weather_section <-
  function(.daily, .hourly) {
    tryCatch(
      {
        if (!is_valid_frame(.daily)) return(NULL)
        .daily <- slice_tail(.daily, n = 1)
        
        hourly <-
          if (!is_valid_frame(.hourly)) {
            NULL
          } else {
            .hourly %>%
              distinct(start_time, .keep_all = TRUE) %>%
              arrange(start_time) %>%
              filter(
                hour(start_time) >= 4,
                hour(start_time) <= 17
              )
          }
        
        hourly_block <-
          if (is_valid_frame(hourly)) {
            tags$div(
              class = "accordion-group",
              tags$button(
                class = "accordion",
                "Hourly forecast"
              ),
              tags$div(
                class = "panel",
                tags$table(
                  class = "schedule-table",
                  tags$thead(
                    tags$tr(
                      tags$th("Time"),
                      tags$th("Forecast"),
                      tags$th("Temp"),
                      tags$th("Rain")
                    )
                  ),
                  tags$tbody(
                    seq_len(nrow(hourly)) %>%
                      map(
                        function(.i) {
                          tags$tr(
                            tags$td(
                              make_pretty_time(hourly$start_time[[.i]])
                            ),
                            tags$td(
                              as.character(hourly$description[[.i]])
                            ),
                            tags$td(
                              str_c(hourly$temperature[[.i]], "\u00b0")
                            ),
                            tags$td(
                              str_c(hourly$chance_of_precip[[.i]], "%")
                            )
                          )
                        }
                      )
                  )
                )
              )
            )
          } else {
            NULL
          }
        
        tagList(
          tags$p(
            tags$strong("Weather: "),
            as.character(.daily$detailed_description[[1]])
          ),
          tags$p(
            class = "weather-summary",
            str_c(
              "High ",
              .daily$high_temp[[1]],
              "\u00b0F \u00b7 Chance of rain ",
              .daily$chance_of_precip[[1]], "%"
            )
          ),
          hourly_block
        )
      },
      error = function(e) NULL
    )
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
