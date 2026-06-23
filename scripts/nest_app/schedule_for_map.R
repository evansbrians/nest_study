# setup --------------------------------------------------------------------

library(tidyverse)

source("scripts/functions.R")

# get and process schedule data --------------------------------------------

schedule <-
  read_rds("data/season_schedule.rds") %>% 
  unnest(patch_counts) %>% 
  unnest(boards) %>% 
  filter(
    week == get_sampling_week()
  ) %>% 
  
  # Subset to only relevant information:
  
  select(
    date,
    patch = patch_count,
    board_id
  )

# predator camera maintenance ----------------------------------------------

next_pred_cam_maintenance <-
  here("data", "predator_camera_maintenance.rds") %>% 
  read_rds() %>% 
  drop_na(camera_id)

# get and process nest data ------------------------------------------------

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
  
  # Assign "Unknown" as the nest_fate for nests that have had 0 eggs and 0 young
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
        "Unknown",
        nest_fate
      ),
    .by = nest_id
  ) %>% 
  
  # Grab the last observation for each nest:
  
  slice_max(date, n = 1, by = nest_id) %>% 
  
  # Do not check if the nest fate is "Success" or "Failure":
  
  filter_out(
    nest_fate %in% c("Success", "Failure", "Unknown")
  ) %>% 
  
  # Earliest nest check is 3 days for ongoing nests:
  
  mutate(
    nest_id,
    patch = patch_id,
    check_freq = 3,
    earliest_check = date + check_freq,
    .keep = "none"
  )

# determine the date of the next nest checks -------------------------------

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
