
# The goal for this script is to create a data frame that can be used as a daily
# and weekly scheduling sheet.

# setup -------------------------------------------------------------------

library(suncalc)
library(tidyverse)

source("pre-field_season/scripts/sampling_scenarios_source.R")

source("pre-field_season/scripts/coverboard_sampling_order.R")

# basic sampling frame ----------------------------------------------------

sampling_start <- 
  tibble(
    date = 
      seq(
        as_date("2026-05-20"),
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
    
    sunrise = 
      our_time(date, .sun = "sunrise") %>% 
      format("%H:%M"),
    
    # Sundays are off by default (if not, choose the arrival and point count
    # time of the previous day):
    
    across(
      arrive:sunrise,
      ~ if_else(
        day == "Sun",
        "-",
        .x
      )
    )
  ) %>% 
  mutate(
    helper = 
      case_when(
        (
          day == "Thu" &
            !week %in% 8:10
        ) ~ "Callie",
        day == "Tue" ~ "Mama S",
        (
          day == "Sat" &
            !week == 1
        ) ~ "Brian",
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

# patch order -------------------------------------------------------------

# Define patches and their optimal order:

# Final decision:

patches <-
  c(
    
    # Wednesday/Saturday (Brian patches): 
    
    "forest_a",
    "grassland_b",
    "leech",
    
    # Monday/Thursday (Callie patches):
    
    "coyote",
    "firehouse",
    "witch_hazel",
    
    # Tuesday/Friday (Mom patches):
    
    "forest_geo",
    "grassland_a",
    "grassland_b_fence"
    
  )

# patch counts ------------------------------------------------------------

# Sequential patches:

patch_counts_sequential <- 
  sampling_start %>% 
  
  # Remove Sundays:
  
  filter(day != "Sun") %>% 
  
  # Repeat each day 4 times:
  
  uncount(3) %>% 
  
  # Assign patches to days:
  
  mutate(
    patch_count = 
      rep_len(
        patches, 
        n()
      )
  ) %>% 
  
  # Add helpers:
  
  mutate(
    helper = 
      case_when(
        day == "Thu" & week %in% 8:10 ~ "-",
        day == "Thu" ~ "Callie",
        day == "Tue" ~ "Mama S",
        day == "Sat" ~ "Brian",
        .default = "-"
      ),
    .after = day
  )

# Randomize patch order on a given day:

patch_counts_randomized <-
  patch_counts_sequential %>% 
  slice_sample(
    n = 4,
    by = "date"
  )

# nest searching: sequential version --------------------------------------

patch_search_sequential <-
  patch_counts_sequential %>% 
  mutate(
    patch_search =
      case_when(
        helper == "-" ~ "-",
        helper == "Brian" ~ NA_character_,
        
        # When you are sampling with Callie and your mom, you will search the
        # last three patches sampled:
        
        patch_count != last(patch_count) ~ patch_count
      ),
    .by = c(week, helper)
  ) %>% 
  
  # When you are sampling with me, all remaining patches will be searched:
  
  mutate(
    patch_search =
      case_when(
        helper == "Brian" & 
          patch_count == last(patch_count) ~
          str_flatten(
            patches[!patches %in% patch_search], 
            collapse = ", "
          ),
        .default = patch_search
      ),
    .by = week
  ) %>% 
  
  # Flatten the counts and searches then remove duplicates:
  
  mutate(
    patch_count = 
      str_flatten(patch_count, collapse = " \u2192 "),
    patch_search = 
      patch_search %>% 
      unique() %>% 
      str_flatten(
        collapse = ", ", 
        na.rm = TRUE
      ),
    .by = date
  ) %>% 
  distinct() %>% 
  select(date, helper, patch_count: patch_search)

# nest searching: random version ------------------------------------------

patch_search_randomized <- 
  patch_counts_randomized %>% 
  mutate(
    patch_search =
      case_when(
        helper == "-" ~ "-",
        helper == "Brian" ~ NA_character_,
        
        # When you are sampling with Callie and your mom, you will search the
        # last three patches sampled:
        
        patch_count != last(patch_count) ~ patch_count
      ),
    .by = c(week, helper)
  ) %>% 
  
  # When you are sampling with me, all remaining patches will be searched:
  
  mutate(
    patch_search =
      case_when(
        helper == "Brian" & 
          patch_count == last(patch_count) ~
          str_flatten(
            patches[!patches %in% patch_search], 
            collapse = ", "
          ),
        .default = patch_search
      ),
    .by = week
  ) %>% 
  
  # Flatten the counts and searches then remove duplicates:
  
  mutate(
    patch_count = 
      str_flatten(patch_count, collapse = " \u2192 "),
    patch_search = 
      patch_search %>% 
      unique() %>% 
      str_flatten(
        collapse = ", ", 
        na.rm = TRUE
      ),
    .by = date
  ) %>% 
  distinct() %>% 
  select(
    date, 
    week, 
    helper, 
    patch_count:patch_search
  ) #%>% 
  # print(n = 30)

# add coverboard order ----------------------------------------------------

patch_counts_season <- 
  patch_counts_randomized %>% 
  pull(patch_count) %>% 
  unique() %>% 
  map_df(
    \(x) {
      
      cb_start <- 
        patch_counts_randomized %>% 
        filter(patch_count == x) %>% 
        select(date, patch_count)
      
      cb_start %>% 
        bind_cols(
          season_schedules %>% 
            pluck(x) %>% 
            slice(
              1:nrow(cb_start)
            )
        )
      
    }
  ) %>% 
  select(date, patch_count:board_2) %>% 
  left_join(
    patch_counts_randomized,
    .,
    by = c("date", "patch_count")
  ) %>% 
  mutate(
    across(
      board_1:board_2,
      ~ str_remove(.x, "[a-z_]*")
    )
  ) %>% 
  unite(
    col = "coverboards",
    board_1:board_2,
    sep = ", "
  ) %>% 
  left_join(
    patch_search_randomized %>% 
      select(
        !c(
          week:patch_count,
        )
      ),
    by = "date"
  )

patch_counts_season %>% 
  clipr::write_clip()

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


