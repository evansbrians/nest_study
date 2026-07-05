library(here)
library(htmltools)
library(tidyverse)

source(
  here("scripts/utils/functions/time_and_date_functions.R")
)
source(
  here("scripts/utils/functions/utility_functions.R")
)
source(
  here("scripts/utils/functions/scheduling_functions.R")
)

schedule_panels <-
  tryCatch(
    {
      schedule_data <- prep_schedule_data(.mark_tall_nests = TRUE)

      updates <-
        read_rds(
          here("data/schedule_updates.rds")
        ) %>%
        mutate(date = as_date(date))
      
      weather <-
        tryCatch(
          read_rds(
            here("data/weather.rds")
          ),
          error = function(e) list()
        )
      
      daily_wx <-
        tryCatch(
          mutate(
            weather$daily,
            date = as_date(date)
          ),
          error = function(e) NULL
        )
      
      hourly_wx <-
        tryCatch(
          mutate(
            weather$hourly,
            date = as_date(date)
          ),
          error = function(e) NULL
        )
      
      schedule_data %>%
        distinct(date, day) %>%
        arrange(date) %>%
        filter(day != "Sun" | date %in% updates$date) %>%
        pull(date) %>%
        map(
          function(.d) {
            day_rows <- filter(schedule_data, date == .d)
            
            row <- filter(updates, date == .d)
            
            search_override <-
              if (nrow(row) > 0) {
                c(row$search_patch_1, row$search_patch_2) %>%
                  as.character() %>%
                  keep(
                    ~ !is.na(.x) && str_trim(.x) != ""
                  )
              } else {
                character()
              }
            
            searched <-
              if (length(search_override) > 0) {
                search_override
              } else {
                day_rows %>%
                  filter(patch_order != 1) %>%
                  arrange(desc(patch_order)) %>%
                  pull(patch_count)
              }
            
            helper <- if (nrow(row) > 0) row$helper else NA
            
            tagList(
              tags$button(
                class = "accordion",
                `data-date` = as.character(.d),
                str_c(
                  wday(.d, label = TRUE, abbr = FALSE),
                  " ",
                  make_pretty_dates(.d, .out_factor = FALSE)
                )
              ),
              tags$div(
                class = "panel",
                tags$p(
                  tags$em(
                    str_c(
                      "Helper: ",
                      dash_blank(helper)
                    )
                  )
                ),
                morning_times_table(day_rows),
                if (is_valid_frame(day_rows)) {
                  tagList(
                    tags$p(
                      tags$strong(
                        "Point count times, coverboards, and nests to check:"
                      )
                    ),
                    pred_counts_table(day_rows)
                  )
                },
                tags$p(
                  tags$strong("Nest searching: "),
                  str_flatten(
                    pretty_patch(searched),
                    collapse = " \u2192 "
                  )
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
