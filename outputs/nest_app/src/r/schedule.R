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
        filter(field) %>%
        distinct(date, day) %>%
        arrange(date) %>%
        pull(date) %>%
        map(
          function(.d) {
            day_rows <- filter(schedule_data, date == .d)

            row <- slice(day_rows, 1)

            searched <-
              c(row$search_patch_1, row$search_patch_2) %>%
              as.character() %>%
              keep(
                ~ !is.na(.x) && str_trim(.x) != ""
              )

            helper <- row$helper
            
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
                  list(row$tns_patch_1, row$tns_patch_2),
                  list(row$helper_patch_1, row$helper_patch_2)
                ),
                note_list(row$notes),
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
