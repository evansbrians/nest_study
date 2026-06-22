
# Script to generate the next maintenance date for each predator camera

# set-up ------------------------------------------------------------------

library(tidyverse)

source("scripts/functions.R")

# Read in data:

season_schedule <- 
  read_rds("data/season_schedule.rds") %>% 
  unnest(patch_counts)

pred_cams <- 
  read_rds("data/field_data.rds") %>% 
  pluck("predator_cameras") %>% 
  unnest(maintenance_activities) 

# camera maintenance schedule ---------------------------------------------

# Define the next two cameras for sampling (one per patch visit):

next_maintenance <- 
  pred_cams %>% 
  
  # Subset to the last time in which any maintenance activity occurred:
  
  filter(
    when_any(install, replace_sd & replace_batteries),
  ) %>% 
  group_by(
    patch = str_remove(camera_id, "_trailcam_[0-2]"),
    camera_id
  ) %>% 
  summarize(
    
    # Set the date as two weeks after the last maintenance activity:
    
    date = max(date) + 14,
    .groups = "drop"
  ) %>% 
  
  # Subset to cameras that need to be sampled in the next week:
  
  filter(
    get_sampling_week(date) <=
      get_sampling_week()
  ) %>% 
  
  # Get the two cameras that are most in need of maintenance in each patch:
  
  slice_min(
    date,
    n = 2,
    with_ties = FALSE,
    by = patch
  ) %>% 
  
  # Assign camera priority:
  
  mutate(
    priority = row_number(),
    .by = patch
  ) %>%
  select(!date)


# Get maintenance schedule for the week:

predator_camera_maintenance <- 
  season_schedule %>% 
  drop_na(patch_count) %>% 
  filter(
    week == get_sampling_week()
  ) %>% 
  select(patch = patch_count, date) %>% 
  arrange(patch, date) %>% 
  mutate(
    visit = row_number(),
    .by = patch
  ) %>% 
  left_join(
    next_maintenance,
    by = join_by(patch, visit == priority)
  ) %>% 
  select(!visit) %>% 
  mutate(
    camera_id = str_extract(camera_id, "[0-2]$")
  )

# write to file -----------------------------------------------------------

write_rds(
  predator_camera_maintenance,
  "data/predator_camera_maintenance.rds"
)

# end session -------------------------------------------------------------

# Update git:

autopush_updates()

# Clear global environment:

rm(
  list = ls()
)
