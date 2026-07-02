
# setup -------------------------------------------------------------------

library(glue)
library(here)
library(googlesheets4)
library(googledrive)
library(sf)
library(httr)
library(tidyverse)

source("scripts/utils/functions/time_and_date_functions.R")
source("scripts/utils/functions/utility_functions.R")
source("scripts/utils/functions/scheduling_functions.R")
source("scripts/utils/functions/weather_functions.R")

# Define folder locations in Drive where waypoints are stored:

scbi_folder <-
  drive_ls(
    as_id("1JE63Iy4_hLRfaHjENlBHDpLYPKgD33B6")
  ) %>%
  filter(name == "scbi")

scbi_point_folders <-
  drive_ls(scbi_folder)

# Create file path/url for each Google sheet:

urls <-
  c(
    coverboards = "1XkozYdl1UfBVF9lMcP9ZjmTHflzF3q7l-NU6t2U11o4",
    point_counts = "10ZsdRqT-oS_C92CpD-RA79QO52DFSHKbT1mwxUZsEIo",
    visits = "1Pd4OYDbRkV3DMDlZU1kFfW2ci2izmtpq8eXY7MvYENY",
    nests = "1iosPhbwDOVhIM4EkaeexnX0kRLsBqZKEuCbCsxFyMPs",
    predator_cameras = "1exlfw40PfefcOLRxf7WUyCi9TOJ3yydKbAXcJNmABfc",
    schedule_updates = "1Pt-PPSekVv4BIM7nhCHPw1cmnUWkfrbjWpGw79-ohiQ"
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

## gps points -------------------------------------------------------------

# Make a template for each point file:

point_template <-
  st_sf(
    point_id = character(),
    name = character(),
    datetime = ymd_hms(tz = "America/New_York"),
    elevation = double(),
    bearing = double(),
    accuracy = double(),
    photo_name = character(),
    photo = character(),
    note = character(),
    geometry = st_sfc(crs = 4326)
  )

class_template <-
  point_template %>% 
  mutate(point_class = character()) %>% 
  select(point_class, everything())

rbind_sf <- 
  function(.lst) {
    .lst <- keep(.lst, \ (.x) nrow(.x) > 0)
    if (length(.lst) == 0) {
      class_template
    } else {
      reduce(.lst, rbind)
    }
  }

# Get current point files (if they exist):

spatial_points <- 
  list(
    "nest",
    "coverboard",
    "trailcam",
    "point_count",
    "landmark",
    "path_crossing",
    "boundary",
    "other"
  ) %>% 
  set_names(.) %>% 
  map(
    \ (.point_class) {
      
      url <-
        file.path(
          "data/spatial",
          str_c(.point_class, "_locations.geojson")
        )
      
      if (file.exists(url)) {
        st_read(url, quiet = TRUE) %>% 
          
          # Ensure the CRS is 4326:
          
          st_transform(4326) %>% 
          
          # Conform to the template:
          
          mutate(
            across(
              matches("elevation|bearing|accuracy"),
              ~ as.numeric(.x)
            ),
            across(
              any_of("datetime"),
              ~ as_datetime(.x)
            )
          ) %>% 
          bind_rows(point_template, .)
      } else {
        point_template
      }
    }
  )

# Collect gps points from Google Drive:

# List the new point files (with their Drive ids) so we can archive them after
# a clean ingest:

point_files <-
  list("individual_points", "bundled_points") %>%
  set_names(.) %>%
  map(
    \ (.subfolder) {
      scbi_point_folders %>%
        filter(name == .subfolder) %>%
        drive_ls() %>%
        filter(
          str_detect(name, "geojson$")
        )
    }
  )

# Download and pre-process each file:

new_points <-
  point_files %>%
  map(
    \ (.files) {
      .files %>%
        pull(id) %>%
        map(
          \ (.id) {
            
            # Define a temporary write path:
            
            .path <- tempfile(fileext = ".geojson")
            
            # Download the file to temp:
            
            drive_download(
              as_id(.id), 
              path = .path, 
              overwrite = TRUE
            )
            
            # Read in the file and pre-process:
            
            st_read(.path, quiet = TRUE) %>% 
              st_transform(4326) %>% 
              rename_with(
                ~ "accuracy", 
                any_of("horizontal_accuracy")
              ) %>% 
              mutate(
                
                # Numeric class columns:
                
                across(
                  matches("elevation|bearing|accuracy"),
                  ~ as.numeric(.x)
                )
              ) %>% 
              bind_rows(point_template, .) %>% 
              mutate(
                datetime = 
                  force_tz(
                    as_datetime(time), 
                    "America/New_York"
                  ),
                
                # Snake case except for point_names of nests:
                
                across(
                  c(point_class, photo_name),
                  ~ tolower(.x) %>% 
                    str_to_snake()
                ),
                name =
                  if_else(
                    str_detect(as.character(point_name), "^N"),
                    as.character(point_name),
                    str_to_snake(as.character(point_name))
                  )
              ) %>% 
              
              # Align with template:
              
              select(
                point_class,
                all_of(
                  names(point_template)
                )
              )
          }
        ) %>%
        rbind_sf()
    }
  ) %>% 
  
  # Combine both sets of files and remove duplicates:
  
  rbind_sf() %>% 
  distinct(point_id, .keep_all = TRUE) %>% 
  
  # Split by point_class:
  
  split(.$point_class)

# Combine previous and new points:

new_points %>%
  
  # Subset to items with at least one row:
  
  keep(
    ~ !is.null(.x) && nrow(.x) > 0
  ) %>% 
  iwalk(
    \ (.x, .name) {
      
      # Define the path:
      
      url <- 
        str_c(.name, "_locations.geojson") %>% 
        file.path("data/spatial", .)
      
      # New and updated points (drop the non-spatial class column):
      
      new_rows <-
        .x %>%
        select(!point_class) %>%
        st_zm(drop = TRUE, what = "ZM")
      
      # Upsert by point_id: keep existing points that are not being updated,
      # add the new and updated points, then overwrite the file:
      
      spatial_points[[.name]] %>%
        st_zm(drop = TRUE, what = "ZM") %>%
        filter(!point_id %in% new_rows$point_id) %>%
        rbind(new_rows) %>%
        mutate(
          name =
            case_when(
              str_detect(name, "^(N|n_)") ~ str_replace(name, "^(N|n_)", "N"),
              .default = name
            )
        ) %>%
        arrange(desc(datetime)) %>%
        distinct(name, .keep_all = TRUE) %>%
        st_write(url, delete_dsn = TRUE)
    }
  )

# Archive the ingested point files so the working folders stay small (keeps both
# this ingest and the app's live nest-ID read fast). Runs only after the upsert
# above succeeds, so nothing is archived unless it reached the spatial files;
# files uploaded mid-run stay put and are picked up next time.

ingested_ids <-
  point_files %>%
  list_rbind() %>%
  pull(id)

if (length(ingested_ids) > 0) {

  archive_folder <-
    scbi_point_folders %>%
    filter(name == "_archive")

  if (nrow(archive_folder) == 0) {
    archive_folder <-
      drive_mkdir("_archive", path = scbi_folder)
  }

  walk(
    ingested_ids,
    \ (.id) drive_mv(as_id(.id), path = archive_folder)
  )
}

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
  
  # NA is somehow getting stuck in:
  
  drop_na(nest_id) %>% 
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

### nests to check --------------------------------------------------------

# Process nest data and determine the earliest next nest check:

current_nests <- 
  nests %>% 
  unnest(interval_data) %>%
  
  # It's probably safest to turn the NA values into 0s:
  
  mutate(
    across(
      host_eggs:host_young,
      ~ replace_na(.x, 0)
    )
  ) %>% 
  
  # Determine the number of days with 0 eggs and 0 young:
  
  summarize_me(
    first_check = min(date),
    last_check = max(date),
    n_checks = n_unique(date),
    n_check_days = 
      as.numeric(last_check - first_check),
    always_empty = sum(host_eggs, host_young) == 0,
    .by = 
      vars(
        nest_id,
        patch = patch_id,
        nest_fate
      )
  ) %>%
  
  # Check if the fate is NA, the number of check days is less than or equal to
  # 10, and it's been empty at every check:
  
  filter(
    is.na(nest_fate),
    !(n_check_days > 10 & always_empty)
  )

### output: the date of the next nest checks in the current week ----------

temp_nest_checking <- 
  current_nests %>% 
  
  # Join with schedule and subset to the checks that will occur in next round of
  # checks:
  
  left_join(
    schedule,
    by = "patch",
    relationship = "many-to-many"
  ) %>% 
  
  # Re-arrange by patch and day to view the nests you have to check on a given
  # day:
  
  arrange(date, patch) %>% 
  
  # Make it flat so that nests to check on a given day are in a single column
  # and row:
  
  summarize(
    check_nests = str_flatten(nest_id, collapse = ", "),
    .by = c(date, patch)
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
  point_counts,
  coverboards,
  visits
)

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

# schedule ----------------------------------------------------------------

# This one's a one step!

schedule_updates <-
  read_sheet(
    urls$schedule_updates,
    col_types = "c"
  ) 

# weather forecast --------------------------------------------------------

read_rds("data/weather.rds") %>%
  update_weather(
    .coords_yx = get_nws_coords("data/spatial/patches.geojson"),
    .outpath = "data/weather.rds"
  )

# write to file -----------------------------------------------------------

lst(
  predator_camera_maintenance,
  current_nests,
  temp_nest_checking,
  field_data,
  schedule_updates
) %>% 
  iwalk(
    \ (.x, .name) {
      write_rds(
        .x, str_c("data/", .name, ".rds")
      )
    }
  )

## render the field map app and re-externalize its data -------------------

quarto::quarto_render("outputs/nest_app/field_map.qmd")

source("scripts/utils/externalize_field_data.R")
externalize_field_data()

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

## render pdf schedule ----------------------------------------------------

# quarto::quarto_render("outputs/print-outs/schedule_pdf.qmd")

## update GE and map printouts --------------------------------------------

# Google Earth:

source("scripts/spatial/update_google_earth.R")

# PNG maps (printed maps):

source("scripts/spatial/update_map_print-outs.R")

# Add, commit, and push to github:

# autopush_updates()
