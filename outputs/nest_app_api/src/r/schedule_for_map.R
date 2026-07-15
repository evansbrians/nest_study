# setup --------------------------------------------------------------------

library(tidyverse)

source(here::here("scripts/utils/functions/time_and_date_functions.R"))
source(here::here("scripts/utils/functions/scheduling_functions.R"))

# The map is driven by the same prep_schedule_data() output as the schedule
# panel, so the two cannot diverge. Giraffes are off here so nest ids match the
# map layer names; field days only; the weather-day shift is already applied.

schedule_data <-
  prep_schedule_data(.mark_tall_nests = FALSE) %>%
  filter(field)

# patches and coverboards per date ------------------------------------------

schedule <-
  schedule_data %>%
  transmute(
    date,
    patch = patch_count,
    boards
  ) %>%
  filter(!is.na(boards)) %>%
  separate_longer_delim(boards, delim = ", ") %>%
  rename(board_id = boards)

# predator camera maintenance -----------------------------------------------

next_pred_cam_maintenance <-
  schedule_data %>%
  transmute(
    date,
    patch = patch_count,
    camera_id = predator_cameras
  ) %>%
  filter(!is.na(camera_id), camera_id != "-")

# nests to check per date ---------------------------------------------------

next_checks <-
  schedule_data %>%
  transmute(
    date,
    patch = patch_count,
    check_nests
  ) %>%
  filter(check_nests != "-") %>%
  separate_longer_delim(check_nests, delim = ", ") %>%
  rename(nest_id = check_nests)
