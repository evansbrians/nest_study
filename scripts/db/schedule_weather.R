# schedule_weather.R --------------------------------------------------------
# Build the per-date `weather` JSON the app's schedule screen renders, from
# data/weather.rds. Sourced by schedule_load.R. Mirrors the old Quarto
# weather_section(): a "Weather: <detailed>" narrative, a "High <t>°F · Chance
# of rain <p>%" summary, and a collapsible hourly table -> one JSON object per
# date: {detailed, summary, hourly:[{time, forecast, temp, rain}]} (hours 4-17,
# deduped, "70°"/"55%"). `daily` keys on date; `hourly` on start_time. Tolerant
# of a missing frame -> empty; returns NULL when there is nothing to attach.

weather_json <- function(.weather) {
  daily <- pluck(.weather, "daily")
  hourly <- pluck(.weather, "hourly")

  daily_by_date <-
    if (is.data.frame(daily) && nrow(daily) > 0) {
      daily %>%
        mutate(
          date = format(as_date(date), "%Y-%m-%d"),
          detailed = as.character(detailed_description),
          summary = str_c("High ", high_temp, "°F · Chance of rain ", chance_of_precip, "%")
        ) %>%
        distinct(date, .keep_all = TRUE) %>%
        select(date, detailed, summary)
    } else {
      tibble(date = character(), detailed = character(), summary = character())
    }

  hourly_by_date <-
    if (is.data.frame(hourly) && nrow(hourly) > 0) {
      hourly %>%
        distinct(start_time, .keep_all = TRUE) %>%
        filter(between(hour(start_time), 4, 17)) %>%
        arrange(start_time) %>%
        mutate(
          date = format(as_date(start_time), "%Y-%m-%d"),
          time = make_pretty_time(start_time),
          forecast = as.character(description),
          temp = str_c(temperature, "°"),
          rain = str_c(chance_of_precip, "%")
        ) %>%
        select(date, time, forecast, temp, rain) %>%
        nest(hourly = !date)
    } else {
      tibble(date = character(), hourly = list())
    }

  combined <- full_join(daily_by_date, hourly_by_date, by = "date")
  if (nrow(combined) == 0) return(NULL)

  combined %>%
    mutate(
      weather = pmap_chr(
        list(detailed, summary, hourly),
        function(.detailed, .summary, .hourly) {
          as.character(jsonlite::toJSON(
            list(
              detailed = .detailed,
              summary = .summary,
              hourly = if (is.null(.hourly)) list() else .hourly
            ),
            auto_unbox = TRUE, na = "null"
          ))
        }
      )
    ) %>%
    select(date, weather)
}
