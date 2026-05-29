
# Script to generate the next maintenance date for each predator camera

# set-up ------------------------------------------------------------------

library(tidyverse)

# Read in data:

season_schedule <- 
  read_rds("data/season_schedule.rds") %>% 
  unnest(patch_counts)

pred_cams <- 
  read_rds("data/field_data.rds") %>% 
  pluck("predator_cameras") %>% 
  unnest(maintenance_activities) 

# camera maintenance schedule ---------------------------------------------

# The next maintenance date is the date closest to two weeks past the last
# maintenance date

predator_camera_maintenance <- 
  pred_cams %>% 
  mutate(
    status = TRUE
  ) %>% 
  pivot_wider(
    names_from = activities,
    values_from = status,
    values_fill = FALSE
  ) %>% 
  select(
    camera_id, 
    date,
    install:replace_batteries
  ) %>% 
  filter(
    install == TRUE |
      (
        replace_sd == TRUE &
          replace_batteries == TRUE
      ),
  ) %>% 
  filter(
    date == max(date),
    .by = camera_id
  ) %>% 
  mutate(
    patch = 
      str_remove(camera_id, "_trailcam_[0-2]"),
    next_maintenance =
      date + 14
  ) %>% 
  mutate(
    next_maintenance =
      season_schedule %>% 
      filter(
        date >= next_maintenance
      ) %>% 
      pull(date) %>% 
      min(),
    .by = c(patch, camera_id)
  ) %>% 
  select(patch, camera_id, next_maintenance)

