
# setup -------------------------------------------------------------------

library(tidyverse)

source("scripts/functions.R")

# get and process schedule data -------------------------------------------

schedule <-
  read_rds("data/season_schedule.rds") %>% 
  unnest(patch_counts) %>% 
  
  # Remove Sundays and subset to between today and within the next week:
  
  filter(
    day != "Sun",
    between(
      date,
      today(),
      today() + 6
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
  drop_na(host_eggs) %>% 

  # Assign "post-fate" as the nest_fate for nests that have had 0 eggs and 0 young
  # for 3 or more checks:
  
  mutate(
    empty = 
      if_else(
        host_eggs == 0 & host_young == 0,
        1,
        0
      ),
    empty_checks = 
      cumsum(
        lag(
          empty, 
          default = first(empty)
        )
      ),
    empty_checks = 
      max(empty_checks),
    nest_fate =
      if_else(
        empty_checks >= 3,
        "post_fate",
        nest_fate
      ),
    .by = nest_id
  ) %>% 
  
  # Grab the last observation for each nest:
  
  slice_max(date, n = 1, by = nest_id) %>% 
  
  # Do not check if the nest fate is "Success" or "Failure":
  
  filter_out(
    nest_fate %in% c("Success", "Failure", "post_fate")
  ) %>% 
  
  # Earliest nest check is 3 days if there are eggs or young and 6 days if
  # there is no eggs or young:
  
  mutate(
    nest_id,
    patch = patch_id,
    check_freq = 
      case_when(
        host_eggs > 0 ~ 3,
        host_young > 0 ~ 3,
        .default = 6
      ),
    earliest_check = date + check_freq,
    .keep = "none"
  )

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
  filter(date >= earliest_check) %>% 
  slice_min(date, by = nest_id) %>% 
  mutate(
    check_1 = date,
    check_2 = date + check_freq,
    .keep = "unused"
  ) %>% 
  pivot_longer(
    check_1:check_2,
    names_to = NULL,
    values_to = "date"
  ) %>% 
  select(nest_id:patch, date) %>% 
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
