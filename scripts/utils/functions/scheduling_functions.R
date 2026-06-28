# Functions for schedule updates


# departure, arrival, and sunrise table -----------------------------------

morning_times <- 
  function(schedule_list, .day) {
    schedule_list %>% 
      pluck(.day) %>% 
      distinct(
        "Home departure" = home_departure_time, 
        "Arrival" = arrive, 
        "Sunrise" = sunrise,
        "SCBI departure" = scbi_departure_time
      ) %>% 
      kable(
        format = "html",
        align = 
          c("c", "c", "c")
      ) %>% 
      my_kable_style() %>% 
      column_spec(1:3, width = "14.5em")
  }

# format point counts and coverboards for a given day ---------------------

pred_counts <- 
  function(schedule_list, .day) {
    schedule_list %>% 
      pluck(.day) %>% 
      mutate(
        Patch = patch_count,
        Time = 
          str_c(date, sunrise) %>% 
          {
            ymd_hm(.) + 
              minutes(40 * (patch_order - 1))
          } %>% 
          format("%H:%M")
      ) %>% 
      select(
        Time,
        Patch = patch_count,
        Coverboards = boards,
        `Check nests` = check_nests,
        `Predator cameras` = predator_cameras
      ) %>% 
      kable(
        format = "html",
        align =
          c(
            "c",
            "l",
            "c",
            "l"
          )
      ) %>% 
      my_kable_style()
  }

# nest searching order ----------------------------------------------------

nest_searching_order <-
  function(
    schedule_list, 
    .day,
    .ordered = TRUE,
    .patches
  ) {
    if(.ordered) {
      schedule_list %>%
        pluck(.day) %>%
        filter(patch_order != 1) %>%
        arrange(
          desc(patch_order)
        ) %>%
        pull(patch_count) %>%
        str_flatten(collapse = " \u2192 ")
    } else {
      .patches %>% 
        str_flatten(collapse = " \u2192 ")
    }
  }

# nest searching activity details -----------------------------------------

nest_searching <- 
  function(
    schedule_list,
    .day = "Tue",
    .ordered = TRUE,
    .helper,
    .patches,
    .helper_patch_1 = "-",
    .me_patch_1 = "-",
    .helper_patch_2 = "-",
    .me_patch_2 = "-"
  ) {
    if(.ordered) {
      start <- 
        schedule_list %>% 
        pluck(.day) %>% 
        filter(patch_order != 1) %>% 
        arrange(
          desc(patch_order)
        ) %>% 
        select(helper, patch_count) %>% 
        mutate(
          patch_count =
            factor(
              patch_count,
              levels = 
                patch_count
            )
        )
    } else {
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
    }
    
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
      # my_kable_style() %>% 
      collapse_rows(
        columns = 1
      )
  }

# hourly weather forecast -------------------------------------------------

make_weather_kable <-
  function(weather, .day_label) {
    weather %>%
      pluck(.day_label) %>% 
      select(day, hourly) %>% 
      unnest(hourly) %>% 
      filter(
        hour(start_time) >= 4,
        hour(start_time) <= 17
      ) %>% 
      mutate(
        Time = 
          hms::as_hms(start_time) %>% 
          as.character() %>% 
          str_remove(":00$"),
        Forecast = short_forecast,
        Temperature = temperature,
        `Chance of rain` = 
          probability_of_precipitation_percent %>% 
          str_c("%"),
        .keep = "none"
      ) %>% 
      kable(
        format = "html",
        align =
          c(
            "c",
            "c"
          )
      ) %>% 
      my_kable_style()
  }

# sampling data for the day -----------------------------------------------

get_day_data <-
  function(
    day_level_data,
    .day_label,
    .me_patch_1 = "",
    .me_patch_2 = "",
    .helper_patch_1 = "-",
    .helper_patch_2 = "-",
    .ordered = TRUE
  ) {
    list(
      date_pretty = day_level_data[[.day_label]]$date_pretty,
      helper = day_level_data[[.day_label]]$helper,
      morning_times = 
        morning_times(.day = .day_label) %>% 
        as.character(),
      predator_counts = 
        pred_counts(.day = .day_label) %>% 
        as.character() %>% 
        str_replace("font-size: 28", "font-size: 14"),
      nest_searching_order = 
        nest_searching_order(.day = .day_label) %>% 
        str_replace("font-size: 28", "font-size: 14"),
      nest_searching_table = 
        nest_searching(
          .day = .day_label,
          .me_patch_1 = {{ .me_patch_1 }},
          .me_patch_2 = {{ .me_patch_2 }},
          .helper_patch_1 = {{ .helper_patch_1 }},
          .helper_patch_2 = {{ .helper_patch_2 }},
          .ordered = .ordered
        ) %>% 
        as.character() %>% 
        str_replace("font-size: 28", "font-size: 14")
    )  
  }

# glued html output for day data ------------------------------------------

make_day_data_output <-
  function(
    .day_label,
    weather,
    .me_patch_1 = "",
    .me_patch_2 = "",
    .helper_patch_1 = "-",
    .helper_patch_2 = "-",
    .ordered = TRUE
  ) {
    
    sampling <- 
      get_day_data(
        .day_label = .day_label,
        .me_patch_1 = "Finish and GPS path from trailcam_2 to CB 3; Create 
    distributaries from the central N-S path",
        .me_patch_2 = "Search near CB 1 and 2 -- carve paths where necessary"
      )
    
    knitr::asis_output(
      glue::glue_data(
        lst(sampling, weather = weather[[.day_label]]),
        '
        <p><strong>Helper</strong>: {sampling$helper}</p>
        
        <div class="summary_box">{sampling$morning_times}</div>

        <p>
          <strong>Point count times, coverboards, and nests to check</strong>:
        </p>

        <div class="summary_box">{sampling$predator_counts}</div>
        
        <p><strong>Nest searching</strong>: {sampling$nest_searching_order}</p>
        
        <div class="summary_box">{sampling$nest_searching_table}</div>
        
        <p>
          <strong>Weather</strong>: {weather$detailed_forecast}
          Chance of rain: {weather$probability_of_precipitation_percent}%.
        </p>
        '
      )
    )
  }

# update weather data file ------------------------------------------------

get_forecast <- 
  function(
    .forecast_type = c("daily", "hourly"),
    .daytime = TRUE,
    .start_hour = 5,
    .end_hour = 16
  ) {
    
    # Starting frame:
    
    forecast <- 
      weather_urls %>% 
      pluck(.forecast_type) %>% 
      query_api() %>% 
      pluck("properties", "periods") %>% 
      as_tibble() %>% 
      janitor::clean_names() %>% 
      
      # A little pre-processing of the starting frame:
      
      mutate(
        across(
          start_time:end_time,
          ~ as_datetime(.x, tz = "America/New_York")
        ),
        date = 
          as_date(start_time, tz = "America/New_York"),
        chance_of_precip = probability_of_precipitation$value,
        .keep = "unused"
      ) %>% 
      relocate(date) %>% 
      select(
        description = short_forecast,
        detailed_description = detailed_forecast,
        !c(number:name)
      )
    
    # Daily forecast:
    
    if(.forecast_type == "daily") {
      if(.daytime) {
        output <- 
          forecast %>% 
          filter(is_daytime) %>% 
          select(
            date,
            high_temp = temperature,
            chance_of_precip,
            description:detailed_description
          )
      } else {
        output <- 
          forecast %>% 
          mutate(
            time_of_day = 
              if_else(
                is_daytime,
                "day",
                "evening"
              )
          ) %>% 
          select(
            date,
            time_of_day,
            temperature,
            chance_of_precip,
            description:detailed_description
          )
      }
    }
    
    # Hourly forecast:
    
    if(.forecast_type == "hourly") {
      output <- 
        forecast %>% 
        mutate(
          
          # Format times:
          
          across(
            start_time:end_time,
            ~ format(.x, "%H:%M"),
            .names = "{.col}_chr"
          ),
          time = glue("{start_time_chr}-{end_time_chr}"),
          
          # Grab just the values for dewpoint and relative humidity:
          
          across(
            dewpoint:relative_humidity,
            ~ pull(.x, value)
          ),
          
          # Convert dewpoint to degrees fahrenheit:
          
          dewpoint = dewpoint * 9 / 5 + 32
        ) %>% 
        filter(
          hour(start_time) >= .start_hour,
          hour(start_time) < .end_hour
        ) %>% 
        select(
          date,
          start_time,
          time,
          temperature,
          dewpoint:relative_humidity,
          chance_of_precip,
          description
        )
    }
    output
  }
