
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

source("scripts/source_script_spatial.R")

# Read in the data:

patches_start <- st_read("data/spatial/proc/patches_edited.geojson")

coverboards <- st_read("data/spatial/proc/coverboards_gps.geojson")

coyote_line <- st_read("data/spatial/proc/coyote_line.geojson")

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
    "data/spatial/proc",
    "patches_edited_2.geojson"
  )
)
