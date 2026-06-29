library(tidyverse)
library(htmltools)

source(here::here("scripts/utils/functions/time_and_date_functions.R"))

# Blank or missing values become a dash:

dash_blank <-
  function(.x) {
    if (is.null(.x) || length(.x) == 0) return("-")
    .x <- as.character(.x[[1]])
    if (is.na(.x) || str_trim(.x) == "") "-" else str_trim(.x)
  }

# Seconds since midnight to an HH:MM label:

format_time <-
  function(.seconds) {
    .seconds <- as.integer(round(.seconds))
    sprintf("%02d:%02d", .seconds %/% 3600L, (.seconds %% 3600L) %/% 60L)
  }

# Home departure, arrival, sunrise and SCBI departure table:

morning_times_table <-
  function(.arrive, .sunrise) {
    if (
      is.null(.arrive) ||
      length(.arrive) == 0 ||
      is.na(.arrive[[1]]) ||
      str_trim(as.character(.arrive[[1]])) == ""
    ) {
      return(NULL)
    }
    arrive <- as.character(.arrive[[1]])
    sunrise <-
      if (is.null(.sunrise) || length(.sunrise) == 0 || is.na(.sunrise[[1]])) {
        "-"
      } else {
        as.character(.sunrise[[1]])
      }
    base <- period_to_seconds(hm(arrive))
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
          tags$td(format_time(base - 45 * 60)),
          tags$td(arrive),
          tags$td(sunrise),
          tags$td(format_time(base + 9 * 3600))
        )
      )
    )
  }

# Point count times, coverboards, nests to check and predator cameras table:

pred_counts_table <-
  function(.rows) {
    if (is.null(.rows) || nrow(.rows) == 0) return(NULL)
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
        seq_len(nrow(.rows)) %>%
          map(
            function(.i) {
              tags$tr(
                tags$td(.rows$time_label[[.i]]),
                tags$td(pretty_patch(as.character(.rows$patch_count[[.i]]))),
                tags$td(as.character(.rows$boards[[.i]])),
                tags$td(as.character(.rows$check_nests[[.i]])),
                tags$td(as.character(.rows$camera_id[[.i]]))
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
              pretty_patch(as.character(.patches[[.i]]))
            )
          if (has_helper) {
            tagList(
              tags$tr(
                patch_cell,
                tags$td("TNS"),
                tags$td(dash_blank(.tns[[.i]]))
              ),
              tags$tr(
                tags$td(dash_blank(.helper)),
                tags$td(dash_blank(.help[[.i]]))
              )
            )
          } else {
            tags$tr(
              patch_cell,
              tags$td("TNS"),
              tags$td(dash_blank(.tns[[.i]]))
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
    if (is.null(.notes) || length(.notes) == 0) return(NULL)
    .notes <- .notes[[1]]
    if (is.na(.notes) || str_trim(.notes) == "") return(NULL)
    items <-
      str_split(.notes, "\n")[[1]] %>%
      str_trim() %>%
      keep(~ .x != "") %>%
      map(~ tags$li(.x))
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

# Weather summary and hourly forecast for a single day:

weather_section <-
  function(.daily, .hourly) {
    tryCatch(
      {
        if (is.null(.daily) || nrow(.daily) == 0) return(NULL)
        .daily <- slice_tail(.daily, n = 1)

        hourly <-
          if (is.null(.hourly) || nrow(.hourly) == 0) {
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
          if (!is.null(hourly) && nrow(hourly) > 0) {
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
                            tags$td(format(hourly$start_time[[.i]], "%H:%M")),
                            tags$td(as.character(hourly$description[[.i]])),
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

schedule_panels <-
  tryCatch(
    {
      week_schedule <-
        read_rds(here::here("data/season_schedule.rds")) %>%
        unnest(patch_counts) %>%
        filter(week == get_sampling_week()) %>%
        mutate(date = as_date(date))

      updates <-
        read_rds(here::here("data/schedule_updates.rds")) %>%
        mutate(date = as_date(date))

      weather <-
        tryCatch(
          read_rds(here::here("data/weather.rds")),
          error = function(e) list()
        )

      daily_wx <-
        tryCatch(
          mutate(weather$daily, date = as_date(date)),
          error = function(e) NULL
        )

      hourly_wx <-
        tryCatch(
          mutate(weather$hourly, date = as_date(date)),
          error = function(e) NULL
        )

      nest_checks <-
        tryCatch(
          {
            high_ids <-
              read_rds(here::here("data/field_data.rds")) %>%
              pluck("nests") %>%
              filter(height > 2) %>%
              pull(nest_id)

            checks <-
              read_rds(here::here("data/temp_nest_checking.rds")) %>%
              mutate(date = as_date(date))

            if (length(high_ids) > 0) {
              checks <-
                checks %>%
                mutate(
                  check_nests =
                    str_replace_all(
                      check_nests,
                      str_c("(", str_c(high_ids, collapse = "|"), ")"),
                      "\\1 \U1F992"
                    )
                )
            }
            checks
          },
          error = function(e) tibble(date = as_date(character()), patch = character(), check_nests = character())
        )

      cameras <-
        tryCatch(
          read_rds(here::here("data/predator_camera_maintenance.rds")) %>%
            mutate(date = as_date(date)) %>%
            drop_na(camera_id),
          error = function(e) tibble(date = as_date(character()), patch = character(), camera_id = character())
        )

      pred_data <-
        tryCatch(
          week_schedule %>%
            unnest(boards) %>%
            summarize(
              boards = str_flatten(board_id, collapse = ", "),
              .by = !board_id
            ) %>%
            left_join(nest_checks, by = join_by(date, patch_count == patch)) %>%
            left_join(cameras, by = join_by(date, patch_count == patch)) %>%
            mutate(
              time_label =
                format(
                  ymd_hm(str_c(date, " ", sunrise)) + minutes(40 * (patch_order - 1)),
                  "%H:%M"
                ),
              across(
                c(check_nests, camera_id),
                ~ replace_na(as.character(.x), "-")
              )
            ),
          error = function(e) NULL
        )

      week_schedule %>%
        distinct(date) %>%
        arrange(date) %>%
        pull(date) %>%
        map(
          function(.d) {
            day_rows <- filter(week_schedule, date == .d)

            searched <-
              day_rows %>%
              filter(patch_order != 1) %>%
              arrange(desc(patch_order)) %>%
              pull(patch_count)

            row <- filter(updates, date == .d)

            helper <- if (nrow(row) > 0) row$helper else NA

            pred_rows <-
              if (is.null(pred_data)) NULL else filter(pred_data, date == .d)

            tagList(
              tags$button(
                class = "accordion",
                `data-date` = as.character(.d),
                str_c(
                  format(.d, "%A"),
                  " ",
                  make_pretty_dates(.d, .out_factor = FALSE)
                )
              ),
              tags$div(
                class = "panel",
                tags$p(
                  tags$em(
                    str_c("Helper: ", dash_blank(helper))
                  )
                ),
                morning_times_table(day_rows$arrive, day_rows$sunrise),
                if (!is.null(pred_rows) && nrow(pred_rows) > 0) {
                  tagList(
                    tags$p(
                      tags$strong(
                        "Point count times, coverboards, and nests to check:"
                      )
                    ),
                    pred_counts_table(pred_rows)
                  )
                },
                tags$p(
                  tags$strong("Nest searching: "),
                  str_flatten(searched, collapse = " \u2192 ")
                ),
                searching_table(
                  searched,
                  helper,
                  list(
                    if (nrow(row) > 0) row$tns_patch_1 else NA,
                    if (nrow(row) > 0) row$tns_patch_2 else NA
                  ),
                  list(
                    if (nrow(row) > 0) row$helper_patch_1 else NA,
                    if (nrow(row) > 0) row$helper_patch_2 else NA
                  )
                ),
                note_list(
                  if (nrow(row) > 0) row$notes else NA
                ),
                weather_section(
                  if (is.null(daily_wx)) NULL else filter(daily_wx, date == .d),
                  if (is.null(hourly_wx)) NULL else filter(hourly_wx, date == .d)
                )
              )
            )
          }
        ) %>%
        tags$div(
          class = "accordion-group",
          `data-open-today` = "true",
          .
        )
    },
    error = function(e) tags$p("The schedule is currently unavailable.")
  )
