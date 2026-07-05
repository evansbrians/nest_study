# setup --------------------------------------------------------------------

library(tidyverse)

source(here::here("scripts/utils/functions/time_and_date_functions.R"))

# field-day shift ----------------------------------------------------------

# The sheet's field == TRUE days for this week. A cancelled non-Sunday day
# (field == FALSE) drops out, so the regular plan slides forward: the i-th
# planned day lands on the i-th field day (identity on a normal week).

field_days <-
  read_rds(here::here("data/schedule_updates.rds")) %>%
  mutate(date = as_date(date)) %>%
  filter(
    field == "TRUE",
    isoweek(date) - 19 == get_sampling_week()
  ) %>%
  arrange(date) %>%
  pull(date)

shift_to_field_days <-
  function(.data, .field_days = field_days) {
    if (!"date" %in% names(.data) || nrow(.data) == 0) {
      return(.data)
    }
    .data <- mutate(.data, date = as_date(date))
    base_days <-
      .data %>%
      filter(isoweek(date) - 19 == get_sampling_week()) %>%
      distinct(date) %>%
      arrange(date) %>%
      pull(date)
    .data %>%
      left_join(
        tibble(
          date = base_days,
          .field_date = .field_days[seq_along(base_days)]
        ),
        by = "date"
      ) %>%
      mutate(date = coalesce(.field_date, date)) %>%
      select(!.field_date)
  }

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
  shift_to_field_days()

# predator camera maintenance ----------------------------------------------

next_pred_cam_maintenance <-
  here::here("data", "predator_camera_maintenance.rds") %>%
  read_rds() %>%
  drop_na(camera_id) %>%
  shift_to_field_days()

# get and process nest data ------------------------------------------------

next_checks <-
  read_rds(here::here("data/temp_nest_checking.rds")) %>%
  separate_longer_delim(check_nests, delim = ", ") %>%
  rename(nest_id = check_nests) %>%
  select(nest_id, patch, date) %>%
  shift_to_field_days()
