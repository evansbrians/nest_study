
# Script to query the National Weather Service API

# setup -------------------------------------------------------------------

library(sf)
library(glue)
library(httr)
library(knitr)
library(kableExtra)
library(tidyverse)

# Get the centroid of our patches as a string in latitude, longitude order:

our_location <- 
  st_read("data/spatial/patches.geojson", quiet = TRUE) %>% 
  st_transform(4326) %>% 
  st_combine() %>% 
  st_centroid() %>% 
  st_coordinates() %>% 
  rev() %>% 
  str_c(collapse = ",")

# Define our use case:

our_user_agent <-
  user_agent(
    "(
    https://evansbrians.github.io/nest_study/outputs/test_pages/docs/nests.html,
    evansbr@si.edu
    )"
  )

# query NWS ---------------------------------------------------------------

# Conduct query to get the URLs for the daily and hourly forecasts:

our_forecast_urls <- 
  
  # Define url with the API endpoint and our location:
  
  str_c("https://api.weather.gov/points/", our_location) %>% 
  
  # Query based on the url and user agent definition:
  
  httr::GET(our_user_agent) %>% 
  
  # Get the URL for our daily and hourly forecasts:
  
  httr::content(
    as = "text",
    encoding = "UTF-8"
  ) %>% 
  jsonlite::fromJSON(simplifyVector = TRUE) %>% 
  pluck("properties") %>% 
  .[c("forecast", "forecastHourly")] %>% 
  set_names("daily", "hourly")

# Here is what the raw forecasts look like:

our_forecast_urls %>%
  set_names(
    c("daily", "hourly")
  ) %>% 
  map(
    ~ httr::GET(.x, our_user_agent) %>% 
      httr::content(
        as = "text",
        encoding = "UTF-8"
      ) %>% 
      jsonlite::fromJSON(simplifyVector = TRUE) %>% 
      pluck("properties", "periods") %>% 
      
      # Some pre-processing:
      
      as_tibble() %>% 
      janitor::clean_names()
  )

# From here, we can build a custom function to get and pre-process a forecast:

get_forecast <-
  function(
    .forecast_type = c("daily", "hourly"),
    .forecast_urls = our_forecast_urls,
    .start_hour = 5,
    .end_hour = 16,
    .daytime_only = TRUE,
    .user_agent = our_user_agent,
    .time_zone = "America/New_York"
  ) {
    forecast <-
      .forecast_urls %>% 
      pluck(.forecast_type) %>% 
      httr::GET(.user_agent) %>% 
      httr::content(
        as = "text",
        encoding = "UTF-8"
      ) %>% 
      jsonlite::fromJSON(simplifyVector = TRUE) %>% 
      pluck("properties", "periods") %>% 
      
      # Some pre-processing:
      
      as_tibble() %>% 
      janitor::clean_names() %>% 
      mutate(
        
        # Get date from start_time (time is reported in UTC):
        
        date = 
          start_time %>% 
          as_datetime() %>% 
          with_tz(tzone = .time_zone) %>% 
          as_date(),
        
        # Precipitation value is a data frame:
        
        chance_of_precip = probability_of_precipitation$value
      ) %>% 
      
      # Rename the descripton columns:
      
      rename(
        description = short_forecast,
        detailed_description = detailed_forecast
      ) %>% 
      
      # Rearrange some columns:
      
      relocate(date) %>% 
      relocate(chance_of_precip, .before = description)
    
    # Output for daily forecast:
    
    if (.forecast_type == "daily") {
      if (.daytime_only) {
        output <- forecast %>% 
          filter(is_daytime) %>% 
          
          # Subset and rename columns:
          
          select(
            date,
            temperature_high = temperature,
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
          
          # Subset and rename columns:
          
          select(
            date,
            time_of_day,
            temperature,
            chance_of_precip,
            description:detailed_description
          )
      }
    } 
    
    # Output for hourly forecast:
    
    if (.forecast_type == "hourly") {
      output <-
        forecast %>% 
        mutate(
          
          # Dates and time to proper date times:
          
          across(
            start_time:end_time,
            ~ as_datetime(.x) %>% 
              with_tz(tzone = .time_zone)
          ),
          
          # Text label formats for times:
          
          across(
            start_time:end_time,
            ~ format(.x, "%H:%M"),
            .names = "{.col}_chr"
          ),
          time = glue("{start_time_chr}-{end_time_chr}"),
          
          # Dewpoint, relative humidity, and precipitation values are data frames:
          
          across(
            dewpoint:relative_humidity,
            ~ pull(.x, value)
          ),
          
          # Dewpoint is provided in degrees celsius for some reason:
          
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

# Example usage (daily -- note the temperatures are the high for the daytime and
# low temperatures for the night):

get_forecast("daily", .daytime_only = TRUE)

# Example usage (daily, daytime and evening -- note the temperatures are the
# high for the daytime and low temperatures for the night):

get_forecast("daily", .daytime_only = FALSE)

# Example usage (hourly, field part of the day):

get_forecast("hourly")

get_forecast(
  "hourly",
  .start_hour = 0, 
  .end_hour = 23
)

# Hourly can also be used to construct relevant conditions for the day

temp %>% 
  filter(date == "2026-06-12") %>% 
  mutate(
    activity = 
      case_when(
        hour(start_time) < 8 ~ "point_count",
        .default = "nest_searching"
      ),
    .after = time
  ) %>% 
  summarize(
    across(
      c(temperature, chance_of_precip),
      .fns = lst(min, max),
      .names = "{.col}_{.fn}"
    ),
    .by = activity
  ) %>% 
  pivot_longer(
    matches("min|max|mean")
  ) %>% 
  mutate(
    variable = str_remove(name, "_min|_max|_mean"),
    stat = 
      str_extract(name, "_min|_max|_mean") %>% 
      str_remove("_"),
    .keep = "unused",
    .after = activity
  ) %>% 
  pivot_wider(
    names_from = stat,
    values_from = value
  )

# output for the daily forecasts ------------------------------------------

# For the daily forecast, I imagine we want a markdown text:

daily_forecast <-
  get_forecast("daily")

daily_forecast %>% 
  filter(date == today() + 1) %>% 
  glue_data(
    "<p>Today will be {tolower(description)}.</p>
    <ul>
    <li><strong>High temperature</strong>: {temperature_high} \u00B0F</li>
    <li><strong>Chance of precipitation</strong>: {chance_of_precip}%
    </ul>
    <p>**Detailed description**: {detailed_description}</p>
    "
  )

# The best output for the hourly forecast is likely just a table without the
# data (as an accordion button).

hourly_forecasts <-
  get_forecast("hourly")

print_hourly_forecast <-
  function (.date, .hourly_forecasts) {
    .hourly_forecasts %>% 
      
      # Grab an example date:
      
      filter(
        date == .date
      ) %>% 
      
      # Remove the date field (we will no longer need it:
      
      select(!date:start_time) %>%
      
      # Add degree and percent symbols:
      
      rename_with(
        ~ str_c(.x, " (\u00B0F)"),
        .cols = temperature:dewpoint
      ) %>% 
      rename_with(
        ~ str_c(.x, " (%)"),
        relative_humidity:chance_of_precip
      ) %>% 
      
      # Give more formal column titles:
      
      rename_with(
        ~ str_to_title(.x) %>% 
          str_replace_all("_", " ")
      ) %>% 
      
      # Tabular output:
      
      kable(
        format = "html",
        align = 
          c(
            rep("c", 5),
            "l"
          )
      ) %>% 
      
      # Style output:
      
      kable_styling(
        bootstrap_options = 
          c(
            "striped",
            "hover",
            "condensed"
          ),
        full_width = FALSE,
        font_size = 14,
        html_font = '"Times New Roman", Times, serif'
      )
  }

# Usage:

print_hourly_forecast(today() + 1, hourly_forecasts)




