
# setup -------------------------------------------------------------------

library(glue)
library(here)
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

# Get and process schedule data:

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

# field_data --------------------------------------------------------------

## coverboards ------------------------------------------------------------

coverboards <-
  
  # Read data:
  
  read_sheet(
    urls$coverboards
  ) %>% 
  
  # Process data:
  
  mutate(
    date = as_date(date)
  ) %>% 
  select(
    patch_id,
    date,
    observer = observer_initials,
    board_num,
    time:notes
  ) %>% 
  nest(count_data = species:notes) %>% 
  nest(board_data = observer:count_data)

## point counts -----------------------------------------------------------

point_counts <- 
  
  # Read data:
  
  read_sheet(
    urls$point_counts,
    col_types = "c"
  ) %>% 
  mutate(
    across(
      `< 25 m`:`> 100 m`,
      ~ as.numeric(.x)
    )
  ) %>% 
  
  # Process data:
  
  pivot_longer(
    `< 25 m`:`> 100 m`,
    names_to = "distance",
    values_to = "count"
  ) %>% 
  mutate(
    count = replace_na(count, 0)
  ) %>% 
  select(
    patch_id:date,
    start_time,
    interval,
    weather,
    observer,
    species:count
  ) %>% 
  nest(count_data = species:count) %>% 
  nest(interval_data = interval:count_data)

## visits -----------------------------------------------------------------

visits <- 
  
  # Read data:
  
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
  ) %>% 
  
  # Process data:
  
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

## nest monitoring --------------------------------------------------------

nests <-
  
  # Read data:
  
  urls$nests %>% 
  sheet_names() %>% 
  set_names() %>% 
  map(
    ~ read_sheet(
      urls$nests,
      sheet = .x
    )
  ) %>% 
  
  # Process data:
  
  {
    left_join(
      .$nest_level,
      .$interval_level,
      by = "nest_id"
    )
  } %>% 
  mutate(
    date = as_date(date),
    across(
      host_eggs:bhco_dead_young,
      ~ as.numeric(.x)
    )
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

## camera_maintenance -----------------------------------------------------

predator_cameras <- 
  
  # Read data:
  
  urls$predator_cameras %>% 
  read_sheet() %>% 
  mutate(
    date = as_date(date)
  ) %>% 
  
  # Process data:
  
  nest(maintenance_activities = date:notes)

# output -----------------------------------------------------------

field_data <-
  lst(
    point_counts,
    coverboards,
    visits,
    nests,
    predator_cameras
  )

# Remove files we will not pass on:

rm(
  urls,
  point_counts,
  coverboards,
  visits
)

# get and process nest data -----------------------------------------------

# Process nest data and determine the earliest next nest check:

nests_proc <- 
  nests %>% 
  unnest(interval_data) %>%
  arrange(
    desc(date)
  ) %>% 
  
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

## output: the date of the next nest checks in the current week -----------

temp_nest_checking <- 
  nests_proc %>% 
  
  # Join with schedule and subset to the checks that will occur in next round of
  # checks:
  
  left_join(
    schedule,
    by = "patch",
    relationship = "many-to-many"
  ) %>% 
  arrange(date, patch) %>% 
  
  # Re-arrange by patch and day to view the nests you have to check on a given
  # day:
  
  summarize(
    check_nests = str_flatten(nest_id, collapse = ", "),
    .by = c(date, patch)
  ) 

# Remove files we will not pass on:

rm(nests_proc)

# camera maintenance schedule ---------------------------------------------

# Define the next two cameras for sampling (one per patch visit):

next_maintenance <- 
  predator_cameras %>% 
  unnest(maintenance_activities) %>% 
  
  # Subset to the last time in which any maintenance activity occurred:
  
  filter(
    when_any(install, replace_sd & replace_batteries),
  ) %>% 
  
  # Summarize by patch and camera (see functions.R):
  
  summarize_me(
    date = max(date) + 14,
    .by = 
      vars(
        patch = str_remove(camera_id, "_trailcam_[0-2]"),
        camera_id
      )
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

## output: maintenance schedule for the current week ----------------------

predator_camera_maintenance <- 
  schedule %>% 
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

# Remove files we will not pass on:

rm(next_maintenance, schedule)

# write to file -----------------------------------------------------------

lst(
  predator_camera_maintenance,
  temp_nest_checking,
  field_data
) %>% 
  imap(
    \ (.x, .name) {
      write_rds(
        .x, str_c("data/", .name, ".rds")
      )
    }
  )

# Let's hold onto field data and clear the rest from the global environment:

ls() %>%
  keep(
    ~ !str_detect(.x, "field_data|autopush")
  ) %>% 
  walk(
    ~ rm(
      list = .x, 
      envir = .GlobalEnv
    )
  )

# Add, commit, and push to github:

autopush_updates()


