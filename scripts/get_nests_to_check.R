
# setup -------------------------------------------------------------------

library(tidyverse)

source("scripts/functions.R")

# get and process schedule data -------------------------------------------

schedule <-
  read_rds("data/season_schedule.rds") %>% 
  unnest(patch_counts) %>% 
  
  # Remove Sundays and subset to to the current week:
  
  filter(
    day != "Sun",
    get_sampling_week(date) == 
      get_sampling_week(
        today()
      )
  ) %>% 
  
  # Subset to only relevant information:
  
  mutate(
    date,
    patch = patch_count,
    .keep = "none"
  )

# get and process nest data -----------------------------------------------

# Read in nest data and subset to variables of interest:

nests_raw <- 
  read_rds("data/field_data.rds") %>% 
  pluck("nests") %>% 
  unnest(interval_data) %>% 
  mutate(
    nest_id, 
    patch_id, 
    nest_fate, 
    date = as_date(date),
    across(
      host_eggs:host_young,
      ~ as.numeric(.x)
    ),
    .keep = "none"
  ) 

# Process data and determine the earliest next nest check:

nests_proc <- 
  nests_raw %>% 
  
  # It's probably safer to turn the NA values into 0s:
  
  mutate(
    across(
      host_eggs:host_young,
      ~ replace_na(.x, 0)
    ),
    
    # Define an empty check as one in which there was no eggs or young:
    
    empty = 
      if_else(
        host_eggs == 0 & host_young == 0,
        1,
        0
      )
  ) %>% 
  
  # Determine the number of consecutive checks with 0 eggs and 0 young:
  
  mutate(
    empty_checks = 
      cumsum(
        lag(
          empty, 
          default = first(empty)
        )
      ) %>% 
      last(),
    .by = nest_id
  ) %>% 
  
  # Do not check if the nest fate is "Success", "Failure", or if there are 5
  # empty checks (I upped empty checks to fit the new schedule of a check every
  # 3 days):
  
  filter_out(
    when_any(
      nest_fate %in% c("Success", "Failure"),
      empty_checks > 5
    )
  ) %>% 
  
  # Subset to nest and patch:
  
  distinct(nest_id, patch = patch_id)

# determine the date of the next nest checks ------------------------------

# Join with schedule and subset to the checks that will occur in next round of
# checks:

next_checks <- 
  nests_proc %>% 
  left_join(
    schedule,
    by = "patch",
    relationship = "many-to-many"
  ) %>% 
  arrange(date, patch)

# Re-arrange by patch and day to view the nests you have to check on a given
# day:

next_checks %>% 
  summarize(
    check_nests = str_flatten(nest_id, collapse = ", "),
    .by = c(date, patch)
  ) %>% 
  write_rds("data/temp_nest_checking.rds")

# end session -------------------------------------------------------------

# Update git:

autopush_updates()

# Clear global environment:

rm(
  list = ls()
)
