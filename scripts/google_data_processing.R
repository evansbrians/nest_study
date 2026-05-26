
# Read and pre-process data from Google Drive

# setup -------------------------------------------------------------------

library(googlesheets4)
library(tidyverse)

# Create file path/url for each Google sheet:

urls <-
  c(
    coverboards = "1XkozYdl1UfBVF9lMcP9ZjmTHflzF3q7l-NU6t2U11o4",
    point_counts = "10ZsdRqT-oS_C92CpD-RA79QO52DFSHKbT1mwxUZsEIo",
    visits = "1Pd4OYDbRkV3DMDlZU1kFfW2ci2izmtpq8eXY7MvYENY",
    nests = "1iosPhbwDOVhIM4EkaeexnX0kRLsBqZKEuCbCsxFyMPs"
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
  pivot_longer(
    host_eggs:bhco_dead_young,
    names_to = "eggs_young",
    values_to = "count_eggs_young"
  ) %>% 
    select(
      
      # Nest level:
      
      nest_id,
      patch_id,
      species,
      
      # Discovery level:
      
      discovery_date,
      discovery_stage,
      
      # Nest fate level:
      
      nest_fate,
      nest_fate_description,
      
      # Nest-site characteristics:
      
      height,
      substrate,
      gps_point,
      location_description,
      
      # Interval-check level:
      
      date,
      time,
      adult_present,
      adult_activity,
      nest_status,
      young_status,
      observer,
      notes,
      
      # Interval-count level:
      
      eggs_young,
      count_eggs_young
    ) %>% 
    nest(
      discovery_data = discovery_date:discovery_stage
    ) %>% 
    nest(
      nest_fate_data = nest_fate:nest_fate_description
    ) %>% 
    nest(
      nest_site_characteristics_data = height:location_description
    ) %>% 
    nest(
      interval_count_data = eggs_young:count_eggs_young
    ) %>% 
    nest(
      interval_data = 
        c(date:notes, interval_count_data)
    )

# write to file -----------------------------------------------------------

list(
  "point_counts" = point_counts_proc,
  "coverboards" = coverboards_proc,
  "visits" = visits_proc,
  "nests" = nests_proc
) %>% 
  write_rds("data/field_data.rds")

# end session -------------------------------------------------------------

# Update git:

autopush_updates()

# Clear global environment:

rm(
  list = ls()
)