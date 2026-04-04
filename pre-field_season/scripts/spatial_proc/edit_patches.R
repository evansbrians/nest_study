
# Script for exploring your spatial files and editing you patch polygons

# setup -------------------------------------------------------------------

# Packages for editing polygons:

library(mapedit)
library(leaflet)
library(leaflet.extras)
library(htmlwidgets)

# The bread-and-butter:

library(sf)
library(tmap)
library(tidyverse)

tmap_mode("view")

source("pre-field_season/scripts/source_script_spatial.R")

read_dir <- "pre-field_season/data/spatial/proc"

# Read in the data:

c(
  patches_start = "patches_edited.geojson",
  coverboards = "coverboards_gps.geojson",
  coyote_line = "coyote_line.geojson"
) %>% 
  map(
    ~ file.path(read_dir, .x) %>% 
      st_read(quiet = TRUE)
  ) %>% 
  list2env(.GlobalEnv)

# Edit patches ------------------------------------------------------------

# Assign a starting point for patches:

patches_edited <- 
  lst(patches_start)

# A first look:

make_map(patches_edited[[1]])

# Steps for patch editing:

# 1. Run the below to generate the leaflet map
# 2. Zoom into your target patch
# 3. Click the edit button
# 4. Drag the points to wherever you want (it adds points dynamically)
# 5. Click "Save" if you like it and "Cancel" if you don't
# 6. Click "Done" when you are done editing
# 7. Check your results

patches_edited[[2]] <-
  edit_patches(patches_edited[[1]])

# Look at the results:

make_map(patches_edited[[2]])

# Note: The use of list and numbering will ensure that you don't have to 
# start over if you make a mistake!

# write -------------------------------------------------------------------

# For now, I recommend avoiding overwriting the patch edit files. I don't like 
# numbering, but:

patches_edited[[2]] %>% 
  st_write(
    file.path(
      "pre-field_season/data/spatial/proc",
      "patches_edited_2.geojson"
    )
  )
