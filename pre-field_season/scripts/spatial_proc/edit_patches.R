
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

source("pre-field_season/scripts/spatial_proc/source_script_spatial.R")

# Read in the data:

c(
  patches_start = "data/spatial/patches.geojson",
  coverboards = "data/spatial/coverboard_locations.geojson",
  coyote_line = "pre-field_season/data/spatial/proc/coyote_line.geojson"
) %>% 
  map(
    ~ st_read(.x, quiet = TRUE)
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
  edit_patches(
    patches_edited[[1]],
    .coyote_line = TRUE,
    .coverboards = TRUE
  )

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
      "patches_edited_10_coyote_new.geojson"
    ),
    append = FALSE
  )

# final version -----------------------------------------------------------

# Writing files to the main data folder!

patches_final <-
  list.files(
    path_spatial,
    pattern = ".*[0-9]{1,2}_.*new"
  ) %>% 
  map(
    ~ file.path(path_spatial, .x) %>% 
      st_read(quiet = TRUE) %>% 
      filter(
        name == str_remove_all(.x, ".*[0-9]{1,2}_|_new|\\.geojson")
      )
  ) %>% 
  bind_rows() 

# Write geojson:

patches_final %>% 
  st_write(
    "data/spatial/patches.geojson",
    delete_dsn = TRUE
  )

## write kml --------------------------------------------------------------

library(xml2)

# Start by writing as a basic kml file: 

patches_final %>% 
  st_write(
    "data/spatial/patches.kml",
    delete_dsn = TRUE
  )

# Read as plain text:

kml_lines <-
  readLines("data/spatial/patches.kml")

readLines("data/spatial/patches_styled.kml") %>% .[[57]]

# Change styling:

kml_lines %>% 
  
  # Replace default red border:
  
  str_replace_all(
    "<LineStyle>.*</LineStyle>",
    "<LineStyle><color>dd00ffff</color><width>1</width></LineStyle>"
  ) %>% 
  
  # Replace fill:
  
  str_replace_all(
    "<PolyStyle>.*</PolyStyle>",
    "<PolyStyle><color>66ffffff</color><fill>1</fill></PolyStyle>"
  ) %>% 
  
  # Write to file:
  
  writeLines("data/spatial/patches.kml")

# Note: Annoyingly, kml formatting is different than html:
# * html: #rrggbb + opacity (ff is fully opaque 00 is transparent)
# * kml: opacity + bbggrr

