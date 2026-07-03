# setup --------------------------------------------------------------------

library(tidyverse)

source(here::here("scripts/utils/functions/time_and_date_functions.R"))

# get and process schedule data --------------------------------------------

schedule <-
  read_rds(here::here("data/season_schedule.rds")) %>%
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
  ) %>%
  apply_schedule_push()

# predator camera maintenance ----------------------------------------------

next_pred_cam_maintenance <-
  here::here("data", "predator_camera_maintenance.rds") %>%
  read_rds() %>%
  drop_na(camera_id) %>%
  apply_schedule_push()

# get and process nest data ------------------------------------------------

next_checks <-
  read_rds(here::here("data/temp_nest_checking.rds")) %>%
  separate_longer_delim(check_nests, delim = ", ") %>%
  rename(nest_id = check_nests) %>%
  select(nest_id, patch, date) %>%
  apply_schedule_push()
