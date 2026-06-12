
# Read, rename, and reupload GPS points from the yellow Garmin

# set-up ------------------------------------------------------------------

library(sf)
library(tidyverse)

source("scripts/functions.R")

# Garmin file location:

garmin_dir <- "/Volumes/GARMIN/Garmin/GPX"

# read and rename function ------------------------------------------------

process_gps_points <- 
  function(
    .date,
    .yellow_garmin_points,
    .renamed_points
  ) {
    
    # Create a tibble of old and new names:
    
    names_frame <- 
      tibble(
        name = .yellow_garmin_points,
        temp_name = .renamed_points
      ) %>% 
      mutate(
        name = as.character(name)
      )
    
    # Read in the waypoints file for that day:
    
    raw_points <- 
      file.path(
        garmin_dir,
        str_c(
          "Waypoints_",
          day(.date),
          "-",
          month(
            .date,
            label = TRUE
          ) %>% 
            str_to_upper(),
          "-26.gpx"
        )
      ) %>% 
      st_read(
        quiet = TRUE
      ) %>% 
      select(
        name,
        elevation = ele,
        datetime = time
      ) 
    
    # Subset points to those within the names frame and rename:
    
    raw_points %>% 
      inner_join(
        names_frame,
        by = "name"
      ) %>% 
      mutate(
        name = temp_name,
        .keep = "unused"
      )
  }

# read and rename points --------------------------------------------------

yellow_garmin_nests <- 
  process_gps_points(
    .date = "2026-06-11",
    .yellow_garmin_points = 341,
    .renamed_points = "N052"
  )

# write to montana --------------------------------------------------------

# PLUG IN THE GARMIN MONTANA

# Write files to the Garmin Montana:

st_write(
  yellow_garmin_nests,
  file.path(
    garmin_dir,
    "yellow_garmin_nests"
  ) %>% 
    str_c(".gpx"),
  driver = "GPX",
  dataset_options = "GPX_USE_EXTENSIONS=YES",
  delete_dsn = TRUE
)
