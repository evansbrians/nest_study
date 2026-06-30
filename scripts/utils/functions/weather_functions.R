# Weather functions

# Get the coordinates in NWS format associated with a set of spatial objects:

get_nws_coords <-
  function(.geojson_file) {
    read_sf(.geojson_file) %>% 
      st_combine() %>%
      st_centroid() %>% 
      st_coordinates() %>% 
      round(digits = 4) %>% 
      rev() %>% 
      str_c(collapse = ",")
  }

# Get the urls for NWS weather:

get_nws_urls <-
  function(.coords_yx) {
    str_c(
      "https://api.weather.gov/points/",
      .coords_yx
    ) %>%
      query_api() %>%
      pluck("properties") %>%
      keep_at(
        c("forecast", "forecastHourly")
      ) %>%
      set_names("daily", "hourly")
  }

# Get the weather forecast and bind it to the previous weather file:

get_forecast <-
  function(
    .url,
    .forecast_type = c("daily", "hourly"),
    .daytime = TRUE,
    .start_hour = 5,
    .end_hour = 16,
    .tz = "America/New_York"
  ) {

    # Starting frame:

    forecast <-
      .url %>%
      query_api() %>%
      pluck("properties", "periods") %>%
      as_tibble() %>%
      janitor::clean_names() %>%

      # A little pre-processing of the starting frame:

      mutate(
        across(
          start_time:end_time,
          ~ as_datetime(.x, tz = .tz)
        ),
        date =
          as_date(start_time, tz = .tz),
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

# Function to either bind old to new weather or just return new weather:

update_weather <-
  function(
    .old_weather = NULL,
    .coords_yx,
    .outpath
    ) {

    # urls for each forecast type:

    weather_urls <-
      get_nws_urls(.coords_yx)
     
    # Download and process weather data:

    new_weather <-
      suppressMessages(
        weather_urls %>%
          imap(
            ~ get_forecast(.url = .x, .forecast_type = .y)
          )
      )

    # Update the existing weather data file:
    
    if (!is.null(.old_weather)) {
      weather <- 
        .old_weather %>%
        imap(
          \ (.old_forecast, .forecast_type) {
            
            # Get new forecast:
            
            new_forecast <-
              pluck(new_weather, .forecast_type)
            
            .old_forecast %>%
              filter(
                date < min(new_forecast$date)
              ) %>%
              bind_rows(new_forecast)
          }
        )
    } else {
      weather <- new_weather
    }
    
    write_rds(weather, .outpath)
  }
