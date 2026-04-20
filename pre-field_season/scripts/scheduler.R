

# setup -------------------------------------------------------------------

library(tidyverse)

source("pre-field_season/scripts/sampling_scenarios_source.R")

# basic sampling frame ----------------------------------------------------

sampling_start <- 
  tibble(
    date = 
      seq(
        as_date("2026-05-15"),
        as_date("2026-08-15"),
        by = 1
      )
  ) %>% 
  mutate(
    week = isoweek(date) - 19,
    day = wday(date, label = TRUE),
    
    # Arrive at dawn:
    
    arrive = 
      our_time(date, .sun = "dawn") %>% 
      format("%H:%M"),
    
    # Start your point count at sunrise:
    
    start_pcount = 
      our_time(date, .sun = "sunrise") %>% 
      format("%H:%M"),
    
    # Sundays are off by default (if not, choose the arrival and point count
    # time of the previous day):
    
    across(
      arrive:start_pcount,
      ~ if_else(
        day == "Sun",
        "-",
        .x
      )
    )
  )
