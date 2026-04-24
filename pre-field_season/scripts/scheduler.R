
# The goal for this script is to create a data frame that can be used as a daily
# and weekly scheduling sheet.

# setup -------------------------------------------------------------------

library(suncalc)
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
    day = 
      wday(date, label = TRUE),
    
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

# example -----------------------------------------------------------------

# As an example scenario:

# * Callie helps Tuesdays (3 patches searched)
# * Mama S. helps Thursdays (3 patches searched)
# * I help Saturdays (which is probably ideal because of traffic; 6 patches
#   searched)

sampling_start %>% 
  mutate(
    helper = 
      case_when(
        day == "Tue" ~ "Callie",
        day == "Thu" ~ "Mama S",
        day == "Sat" ~ "Brian",
        .default = "-"
      ),
    search_patches = 
      case_when(
        day == "Tue" ~ " ",
        day == "Thu" ~ " ",
        day == "Sat" ~ " ",
        .default = "-"
      )
  )

# next steps --------------------------------------------------------------

# 1. We need to group patches into sets that will be checked (nest check, point
# count, coverboards) on a given day.

# 2. We need to figure out which days your mom, Callie, and I will be coming 
# out. That will tell us how many patches will be searched on a given day and 
# on which day.

# 3. Align the sampling schedule in `sampling_scenarios.R` with the dates.

# 4. Add the coverboard check order

# 5. Determine what the google spreadsheet & field sheet will look like for this


