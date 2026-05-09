
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

# We need to ...

# 1. Group patches into sets that will be checked (nest check, point count,
# coverboards) on a given date. Those cannot be random (because of the 3-day
# nest check interval), but will not likely fall on the same day each week
# (e.g., Mondays).

# 2. Figure out which patches will be searched on a given day -- for days with
# Callie and your mom, this will be the same as the patches that are checked
# (-1, I think). You *will* be checking at least one patch more than once per
# week. I say you schedule the first check of a patch in a given week and any
# additional checks can happen at the patches that you think require an
# additional search (i.e., the extra sampling does not have to be scheduled)

# 3. Randomly assign the order of the patches checked on a given date. For
# example, perhaps on Monday you check coyote, banding, firehouse, and grassland
# a then Thursday you check firehouse, coyote, grassland a, and banding. This
# limits bias associated with point count times.

# 4. Align the sampling schedule in `sampling_scenarios.R` with the dates.

# 5. Modify the coverboard order script such that it uses spatial distance
# rather than just numbering and define the order for each date.

# 6. Determine what the google spreadsheet & field sheet will look like for this.

# 7. Add all of the above to sampling start (so that each of the above is 
# associated with a date and populate a google spreadsheet.


