
# Script to get the weather forecast for the week

# set-up ------------------------------------------------------------------

library(httr)
library(sf)
library(tidyverse)

# Read in patches to determine the centroid of sampling locations:

coords <-
  read_sf("data/spatial/patches.geojson") %>% 
  st_combine() %>%
  st_centroid() %>% 
  st_coordinates() %>% 
  round(digits = 4) %>% 
  as_tibble() %>% 
  set_names(
    c("lon", "lat")
  )

coords_string <-
  str_c(
    coords$lat,
    coords$lon,
    sep = ","
  )

# NWS API -----------------------------------------------------------------

weather <-
  str_c(
    "https://api.weather.gov/points/",
    coords_string
  ) %>% 
  GET() %>% 
  content(as = "text") %>% 
  jsonlite::fromJSON()

# function to get weather -------------------------------------------------

get_weather <- 
  function(.hourly = TRUE) {
    
    forecast <- "forecast"
    
    if(.hourly) {
      forecast <- 
        str_c(forecast, "Hourly")
    }
    
    messy_weather <-
      weather %>% 
      pluck("properties") %>% 
      pluck(forecast) %>% 
      GET() %>% 
      content(as = "text") %>% 
      jsonlite::fromJSON() %>% 
      pluck("properties") %>% 
      pluck("periods") %>% 
      as_tibble() %>% 
      janitor::clean_names() %>% 
      unnest(
        probability_of_precipitation,
        names_sep = "_"
      ) %>%
      mutate(
        temperature = 
          str_c(
            temperature, 
            temperature_unit,
            sep = " "
          ),
        across(
          start_time:end_time,
          ~ as_datetime(.x, tz = "America/New_York")
        ),
        .keep = "unused"
      )
    
    if(.hourly) {
      messy_weather %>%
        unnest(
          relative_humidity,
          names_sep = "_"
        ) %>% 
        select(
          start_time:end_time,
          temperature,
          "probability_of_precipitation_percent" = probability_of_precipitation_value,
          "relative_humidity_percent" = relative_humidity_value,
          wind_speed,
          short_forecast:detailed_forecast
        )
    } else {
      messy_weather %>% 
        select(
          start_time:temperature,
          "probability_of_precipitation_percent" = probability_of_precipitation_value,
          wind_speed,
          short_forecast:detailed_forecast
        )
    }
  }
