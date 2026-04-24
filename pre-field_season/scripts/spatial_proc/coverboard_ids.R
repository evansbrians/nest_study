
# setup -------------------------------------------------------------------

library(sf)
library(tmap)
library(tidyverse)

tmap_mode("view")

# Path to files:

path_spatial <-
  "pre-field_season/data/spatial/proc"

# Coverboard placement (provides ids):

cb_placement <- 
  file.path(path_spatial, "coverboard_placement.geojson") %>% 
  st_read(quiet = TRUE) %>%
  mutate(
    board_id = str_extract(name, "[0-9]")
  )

# Coverboard GPS points:

cb_gps <- 
  file.path(path_spatial, "coverboards_gps.geojson") %>% 
  st_read(quiet = TRUE)

# Get patches for adding the current patch identity:

patches <-
  st_read("data/spatial/patches.geojson", quiet = TRUE)

# look at the data --------------------------------------------------------

tm_basemap("Esri.WorldImagery") +
  tm_view(set_view = 15) +
  
  # The actual points (locations recorded GPS): 
  
  tm_shape(coverboards_gps) +
  tm_symbols(
    fill = "yellow", 
    col = "black",
    size = 0.25,
    fill_alpha = 1
  ) +
  
  # The planning points (contains coverboard id): 
  
  tm_shape(cb_placement) +
  tm_text(
    "board_id",
    col = "red", 
    size = 1
  )

# adding information to the gps file --------------------------------------

cb_labels_start <- 
  cb_gps %>% 
  
  # Get patch IDs by joining the closes patches:
  
  st_join(
    patches %>% 
      rename(patch_id = name),
    join = st_nearest_feature
  ) %>% 
  
  # Get potential board IDs by joining the closest planning locations:
  
  st_join(
    cb_placement %>% 
      select(!name),
    join = st_nearest_feature
  )

# Have a look at how they line up (we know they won't for coyote):

tm_basemap("Esri.WorldImagery") +
  tm_view(set_view = 15) +
  
  # The actual points (locations recorded GPS): 
  
  tm_shape(cb_labels_start) +
  tm_text(
    "board_id",
    col = "yellow", 
    size = 1
  ) +
  
  # The planning points (contains coverboard id): 
  
  tm_shape(cb_placement) +
  tm_text(
    "board_id",
    col = "red", 
    size = 1
  )

# All looks good ... except for coyote and Forest B #6! I think renumbering this one from S to N might make the most sense. T's decision.

# Another idea: Start at the southmost point and the next number in a series
# will be the closest board (or something like that).
