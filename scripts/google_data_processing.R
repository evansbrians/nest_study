
# Read and pre-process data from Google Drive

# setup -------------------------------------------------------------------

library(googlesheets4)
library(tidyverse)

source("scripts/functions.R")

# Create file path/url for each Google sheet:

urls <-
  c(
    coverboards = "1XkozYdl1UfBVF9lMcP9ZjmTHflzF3q7l-NU6t2U11o4",
    point_counts = "10ZsdRqT-oS_C92CpD-RA79QO52DFSHKbT1mwxUZsEIo",
    visits = "1Pd4OYDbRkV3DMDlZU1kFfW2ci2izmtpq8eXY7MvYENY",
    nests = "1iosPhbwDOVhIM4EkaeexnX0kRLsBqZKEuCbCsxFyMPs",
    predator_cameras = "1exlfw40PfefcOLRxf7WUyCi9TOJ3yydKbAXcJNmABfc"
  ) %>% 
  map(
    ~ file.path(
      "https://docs.google.com/spreadsheets/d",
      .x
    )
  )

# coverboards -------------------------------------------------------------

coverboards_raw <- 
  urls$coverboards %>% 
  sheet_names() %>% 
  set_names() %>% 
  map_df(
    ~ read_sheet(
      urls$coverboards,
      sheet = .x
    )
  )

coverboards_proc <- 
  coverboards_raw %>% 
  select(
    patch_id,
    date,
    "observer" = observer_initials,
    board_num,
    time:notes
  ) %>% 
  nest(count_data = species:notes) %>% 
  nest(board_data = observer:count_data)

# point counts ------------------------------------------------------------

point_counts_raw <- 
  read_sheet(
    urls$point_counts,
    col_types = "c"
  ) %>% 
  mutate(
    across(
      `< 25 m`:`> 100 m`,
      ~ as.numeric(.x)
    )
  )

point_counts_proc <- 
  point_counts_raw %>% 
  pivot_longer(
    `< 25 m`:`> 100 m`,
    names_to = "distance",
    values_to = "count"
  ) %>% 
  mutate(
    count = replace_na(count, 0)
  ) %>% 
  select(
    patch_id:start_time,
    interval,
    observer,
    species:count
  ) %>% 
  nest(count_data = species:count) %>% 
  nest(interval_data = observer:count_data) %>% 
  nest(data = interval:interval_data)

# visits ------------------------------------------------------------------

visits_raw <- 
  read_sheet(
    urls$visits
  ) %>% 
  filter(
    !if_all(
      date:helper,
      ~ is.na(.x)
    )
  ) %>% 
  mutate(
    date = as_date(date)
  )

visits_proc <- 
  visits_raw %>% 
  pivot_longer(
    point_count:patch_maintenance,
    names_to = "activity",
    values_to = "status"
  ) %>% 
  select(
    date,
    helper,
    patch,
    notes,
    activity:status
  ) %>% 
  nest(activities = activity:status) %>% 
  nest(patch_level = patch:activities)

# nest monitoring ---------------------------------------------------------

nests_raw <- 
  urls$nests %>% 
  sheet_names() %>% 
  set_names() %>% 
  map(
    ~ read_sheet(
      urls$nests,
      sheet = .x
    )
  )

nests_proc <-
  left_join(
    nests_raw$nest_level,
    nests_raw$interval_level,
    by = "nest_id"
  ) %>% 
  select(
    
    # Nest level:
    
    nest_id:gps_point,
    location_description:nest_fate_description,
    
    # Interval-check level:
    
    date:notes,
  ) %>% 
  nest(
    interval_data = date:notes
  )

# camera_maintenance ------------------------------------------------------

predator_cameras_raw <- 
  urls$predator_cameras %>% 
  read_sheet() %>% 
  mutate(
    date = as_date(date)
  )

predator_cameras_proc <- 
  predator_cameras_raw %>% 
  nest(maintenance_activities = date:notes)

# write to file -----------------------------------------------------------

list(
  "point_counts" = point_counts_proc,
  "coverboards" = coverboards_proc,
  "visits" = visits_proc,
  "nests" = nests_proc,
  "predator_cameras" = predator_cameras_proc
) %>% 
  write_rds("data/field_data.rds")

# end session -------------------------------------------------------------

# Update git:

autopush_updates()

# Clear global environment:

rm(
  list = ls()
)