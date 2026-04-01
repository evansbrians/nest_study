
# Script for processing GPS and KMZ files

# Author: Brian Evans
# Created on: 2026-03-25
# Last modified: 2026-04-01

# Goals:
# * Read Garmin files (GPSX) and convert them to points
# * Read Google Earth KMZ files and convert them to polygons

# setup -------------------------------------------------------------------

library(sf)
library(tmap)
library(tidyverse)

# Simplify by assigning the reading and writing directories:

.read_dir <- "data/spatial/raw"
.write_dir <- "data/spatial/proc"

# read and pre-process GPS files ------------------------------------------

# Points taken when we installed the coverboards: 

coverboards_gps <-
  file.path(.read_dir, "coverboard_gps") %>% 
  list.files(full.names = TRUE) %>% 
  map_df(
    ~ st_read(
      .x, 
      quiet = TRUE,
      layer = "waypoints"
    )
  ) %>% 
  select(
    name, 
    elevation = ele, 
    datetime = time
  )

# Points taken to establish the new boundary for the Coyote patch:

coyote_line <-
  file.path(.read_dir, "Waypoints_26-MAR-26.gpx") %>% 
  st_read(
    quiet = TRUE,
    layer = "waypoints"
  ) %>% 
  select(
    name,
    elevation = ele,
    datetime = time
  )

# KMZ files (Google Earth) ------------------------------------------------

# Google Earth KMZ to KML (our initial map):

file.path(.read_dir, "nest_study_google_earth.kmz") %>% 
  unzip(exdir = "data/spatial/raw")

# Get patches:

patches_start <- 
  file.path(.read_dir, "doc.kml") %>% 
  st_read(
    layer = "patches",
    quiet = TRUE
  ) %>% 
  
  # Remove the patch that no longer has shrubs:
  
  filter(Name != "racetrack_sw")

# For each patch, read in the file that represents where we intended to place
# the coverboards:

coverboard_placement <-
  patches_start %>% 
  pull(Name) %>% 
  str_c("_cb") %>% 
  
  # Read in the files:
  
  map_df(
    ~ file.path(.read_dir, "doc.kml") %>% 
      st_read(
        layer = .x,
        quiet = TRUE
      )   
  )

# Clean files:

lst(patches_start, coverboard_placement) %>% 
  map(
    ~ janitor::clean_names(.x) %>% 
      select(name) %>% 
      
      # Strip Google Earth's weird altitude class (POLYGON Z):
      
      st_zm(polyZ, drop = TRUE)
  ) %>% 
  list2env(.GlobalEnv)

# Delete the temporary KML:

file.path(.read_dir, "doc.kml") %>% 
  file.remove()

# write processed data ----------------------------------------------------

# Get the objects and names:

mget(
  ls()
) %>% 
  
  # Map across each object/name pair:
  
  imap(
    \(obj, file_name) {
      
      # Write to file:
      
      obj %>% 
      write_sf(
        file.path(.write_dir, file_name) %>% 
          str_c(".geojson"),
        delete_dsn = TRUE
      )
    }
  )

rm(
  list = ls()
)