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
              as.character(.patches[[.i]])
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
  function(.wx) {
    tryCatch(
      {
        if (is.null(.wx) || nrow(.wx) == 0) return(NULL)

        hourly <-
          .wx %>%
          select(hourly) %>%
          unnest(hourly) %>%
          distinct(start_time, .keep_all = TRUE) %>%
          arrange(start_time) %>%
          filter(
            hour(start_time) >= 4,
            hour(start_time) <= 17
          )

        hourly_block <-
          if (nrow(hourly) > 0) {
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
                            tags$td(as.character(hourly$short_forecast[[.i]])),
                            tags$td(
                              str_c(
                                str_extract(as.character(hourly$temperature[[.i]]), "[0-9]+"),
                                "\u00b0"
                              )
                            ),
                            tags$td(
                              str_c(hourly$probability_of_precipitation_percent[[.i]], "%")
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
            as.character(.wx$detailed_forecast[[1]])
          ),
          tags$p(
            class = "weather-summary",
            str_c(
              "High ",
              str_extract(as.character(.wx$temperature[[1]]), "[0-9]+"),
              "\u00b0F \u00b7 Chance of rain ",
              .wx$probability_of_precipitation_percent[[1]], "%"
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
        distinct(date, patch_count, patch_order) %>%
        mutate(date = as_date(date))

      updates <-
        read_rds(here::here("data/schedule_updates.rds")) %>%
        mutate(date = as_date(date))

      weather <-
        tryCatch(
          read_rds(here::here("data/weather.rds")) %>%
            mutate(wx_date = as_date(start_time)) %>%
            split(.$wx_date),
          error = function(e) list()
        )

      week_schedule %>%
        distinct(date) %>%
        arrange(date) %>%
        pull(date) %>%
        map(
          function(.d) {
            searched <-
              week_schedule %>%
              filter(date == .d, patch_order != 1) %>%
              arrange(desc(patch_order)) %>%
              pull(patch_count)

            row <- filter(updates, date == .d)

            helper <- if (nrow(row) > 0) row$helper else NA

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
                weather_section(weather[[as.character(.d)]])
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
