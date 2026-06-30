# Functions for schedule updates

# functions for app version *and* pdf -------------------------------------

## season schedule to a joined per-day data frame -------------------------

prep_schedule_data <- 
  function(.mark_tall_nests = FALSE) {
    
    ### nest checks -------------------------------------------------------
    
    nest_checks <-
      tryCatch(
        {
          # Read in data:
          
          checks <-
            read_rds(
              here::here("data/temp_nest_checking.rds")
            )
          
          # If it's the app-version, add giraffes where necessary:
          
          if(.mark_tall_nests) {
            
            # Nests that require a selfie-stick:
            
            giraffe_nests <-
              read_rds(
                here::here("data/field_data.rds")
              ) %>% 
              pluck("nests") %>% 
              filter(selfie_stick) %>% 
              pull(nest_id) %>% 
              str_c(collapse = "|") %>% 
              str_c("(", ., ")")
            
            checks <-
              checks %>% 
              mutate(
                
                # Add giraffes:
                
                check_nests =
                  if_else(
                    str_detect(check_nests, giraffe_nests),
                    str_replace_all(
                      check_nests, 
                      giraffe_nests,
                      "\\1 \U1F992"
                    ),
                    check_nests
                  )
              )
          }
          checks
        },
        error = 
          function(e) 
            tibble(
              date = as_date(character()),
              patch = character(),
              check_nests = character()
            )
      )
    
    ### trail cameras -----------------------------------------------------
    
    cameras <- 
      tryCatch(
        read_rds(
          here::here("data/predator_camera_maintenance.rds")
        ) %>% 
          drop_na(camera_id) %>% 
          summarize(
            predator_cameras = str_flatten(camera_id, collapse = ", "),
            .by = !camera_id
          ),
        error = 
          function(e) 
            tibble(
              date = as_date(character()),
              patch = character(),
              predator_cameras = character()
            )
      )
    
    ### schedule ----------------------------------------------------------
    
    # Get and process the new schedule:
    
    new_schedule <-
      read_rds(here::here("data/schedule_updates.rds")) %>%
      mutate(
        date = as_date(date)
      ) %>% 
      select(
        !day,
        sp1 = search_patch_1,
        sp2 = search_patch_2
      )
    
    ### schedule from file ------------------------------------------------
    
    read_rds(
      here::here("data/season_schedule.rds")
    ) %>% 
      
      # Subset to the sampling week:
      
      filter_me(
        week == get_sampling_week()
      ) %>% 
      
      # Define search patches:
      
      unnest(patch_counts) %>% 
      mutate(
        search_patch_1 = patch_count[patch_order == 3],
        search_patch_2 = patch_count[patch_order == 2],
        .by = date
      ) %>% 
      
      # Boards sampled per patch:
      
      unnest(boards) %>% 
      summarize(
        boards = str_flatten(board_id, collapse = ", "),
        .by = !board_id
      ) %>% 
      
      # Add nests to check:
      
      left_join(
        nest_checks,
        by = join_by(date, patch_count == patch)
      ) %>% 
      
      # Add cameras to maintain:
      
      left_join(
        cameras,
        by = join_by(date, patch_count == patch)
      ) %>% 
      
      # Add new scheduling data:
      
      select(!helper) %>% 
      left_join(
        new_schedule,
        by = "date"
      ) %>% 
      mutate(
        search_patch_1 = 
          if_else(
            is.na(sp1),
            search_patch_1,
            sp1
          ),
        search_patch_2 = 
          if_else(
            is.na(sp2),
            search_patch_2,
            sp2
          ),
        .keep = "unused"
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





## full day block, driven by the schedule-updates Google sheet ------------

day_block <- 
  function(
    .wday,
    .schedule_list = schedule_list,
    .updates = schedule_updates
  ) {
    
    # This weekday's date, and its row in the sheet:
    
    .date <-
      .schedule_list %>%
      pluck(.wday) %>%
      pull(date) %>%
      first()
    
    row <- 
      .updates %>% 
      filter(date == .date)
    
    # Pull one sheet value (a dash when blank or absent):
    
    sheet_val <-
      function(.col) {
        dash_blank(row[[.col]])
      }
    
    helper <- sheet_val("helper")
    notes <- sheet_val("notes")
    
    # The scheduled searching order, and any override from the sheet:
    
    scheduled_patches <- 
      .schedule_list %>% 
      pluck(.wday) %>% 
      filter(patch_order != 1) %>% 
      arrange(
        desc(patch_order)
      ) %>% 
      pull(patch_count)
    
    search_override <- 
      c(
        sheet_val("search_patch_1"),
        sheet_val("search_patch_2")
      ) %>% 
      keep(~ .x != "-")
    
    order_patches <- 
      if (length(search_override) > 0) search_override else scheduled_patches
    
    table_patches <- 
      if (length(search_override) == 2) search_override else scheduled_patches
    
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
    
    nest_searching_order(.patches = order_patches)
    
    nest_searching(
      .helper = helper,
      .patches = table_patches,
      .helper_patch_1 = sheet_val("helper_patch_1"),
      .me_patch_1 = sheet_val("tns_patch_1"),
      .helper_patch_2 = sheet_val("helper_patch_2"),
      .me_patch_2 = sheet_val("tns_patch_2")
    )
  }
