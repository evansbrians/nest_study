
# This is a start of a path processing script. It's currently a Sunday task
# because you'll have to go through it path-by-path and ensure the output makes
# sense. I'm working on an alternative version!

# setup -------------------------------------------------------------------

library(sf)
library(smoothr)
library(tmap)
library(tidyverse)

tmap_mode("view")

source("scripts/functions.R")

# Define a basemap across operations (to avoid repetition):

basemap <- 
  leaflet() %>%
  
  # Base tile layers:
  
  addProviderTiles(
    providers$Esri.WorldImagery,
    group = "Satellite",
    options = tileOptions(maxZoom = 21)
  )

# Get patch names:

patch_names <- 
  st_read("data/spatial/patches.geojson") %>% 
  pull(name)

# Get current track data:

paths <- 
  st_read("data/spatial/tracks.geojson", quiet = TRUE) %>%
  
  # Subset to paths with a defined patch:
  
  filter(
    str_detect(
      name, 
      str_c(patch_names, collapse = "|")
    ),
    !str_detect(name, "line|_7")
  ) %>% 
  
  # Add a patch columns:
  
  mutate(
    patch = str_remove(name, "_(path|b)_[0-9]+")
  ) %>% 
  
  # Change to UTM Zone 18N (projected coords are needed for several operations):
  
  st_transform(32618) %>% 
  
  # Convert from MULTILINESTRING to LINESTRING:
  
  st_cast("LINESTRING", warn = FALSE) %>% 
  
  # Convert to a list:
  
  split(.$patch)

# coyote example -----------------------------------------------------------

# I'll use this to walk through the full process, after that the smoothing and
# doubling-back repair can be completed for all paths simultaneously.

## 1. an initial look ------------------------------------------------------

# Define a color palette for the first few explorations:

pal <- 
  colorFactor(
    palette = "Set2",
    domain = paths$coyote$name
  )

# Combine layers:

basemap %>% 
  
  # Add lines:
  
  addPolylines(
    data = st_transform(paths$coyote, 4326),
    weight = 3,
    opacity = 0.9,
    color = ~ pal(name),
    label = ~ name
  )

## 2. smooth paths --------------------------------------------------------

paths_smooth <-
  paths$coyote %>% 
  smoothr::smooth(
    method = "ksmooth",
    smoothness = 10,
    max_distance = 5
  )

# Have a look:

basemap %>% 
  
  # Add lines:
  
  addPolylines(
    data = st_transform(paths_smooth, 4326),
    weight = 3,
    opacity = 0.9,
    color = ~ pal(name),
    label = ~ name
  )

## 3. Repair any doubling back points in paths ----------------------------

paths_repaired <-
  paths_smooth %>% 
  average_self_overlapping_paths() %>% 
  bind_rows()

# Have a look:

basemap %>% 
  
  # Add lines:
  
  addPolylines(
    data = st_transform(paths_repaired, 4326),
    weight = 3,
    opacity = 0.7,
    color = ~ pal(name),
    label = ~ name
  )

## 4. average path --------------------------------------------------------

# Average paths that are overlapping:

paths_averaged <-
  average_different_paths(
    paths_repaired,
    .target_name = "coyote_path_1",
    .modifier_name = "coyote_path_3"
  )

# Have a look:

basemap %>% 
  addPolylines(
    data = st_transform(paths_repaired, 4326),
    weight = 3,
    opacity = 0.9,
    dashArray = "2, 5",
    color = ~ pal(name),
    label = ~ name
  ) %>%
  addPolylines(
    data = 
      paths_averaged %>% 
      filter(name == "coyote_path_1") %>%
      st_transform(4326),
    weight = 3,
    opacity = 0.9,
    color = "#ffff00",
    label = ~ name
  )

## 5. branches to their own paths -----------------------------------------

# Define the branches:

coyote_path_3_branches <-
  get_branches(
    .target_line =
      paths_averaged %>% 
      filter(name == "coyote_path_3"),
    .reference_line = 
      paths_averaged %>% 
      filter(name == "coyote_path_1"), 
    .branch_distance = 1.5
  )

# Have a look:

basemap %>% 
  addPolylines(
    data = 
      coyote_path_3_branches$branch_1 %>% 
      st_transform(4326),
    weight = 3,
    opacity = 0.7,
    dashArray = "2, 5",
    color = "#ffff00",
    label = ~ name
  ) %>%
  addPolylines(
    data = 
      coyote_path_3_branches$branch_2 %>% 
      st_transform(4326),
    weight = 3,
    opacity = 0.7,
    dashArray = "2, 5",
    color = "#00ffff",
    label = ~ name
  ) %>%
  addPolylines(
    data =
      paths_averaged %>%
      filter(name != "coyote_path_3") %>% 
      st_transform(4326),
    weight = 3,
    opacity = 0.7,
    color = "#ff0000",
    label = ~ name
  )

## 6. snap branches to reference paths ------------------------------------

coyote_branch_1 <- 
  coyote_path_3_branches$branch_1 %>% 
  snap_paths(
    .reference_line = filter(paths_averaged, name != "coyote_path_3"),
    .tolerance = 5,
    .first = TRUE,
    .last = TRUE
  )

coyote_branch_2 <-
  snap_paths(
    .target_line = coyote_path_3_branches$branch_2,
    .reference_line = filter(paths_averaged, name != "coyote_path_3"),
    .first = TRUE,
    .last = TRUE
  )

coyote_branch_3 <-
  snap_paths(
    .target_line = 
      filter(paths_averaged, name == "coyote_path_2"),
    .reference_line =
      filter(paths_averaged, name != "coyote_path_2"),
    .first = TRUE,
    .last = TRUE,
    .tolerance = 20
  )

# Have a look:

basemap %>% 
  addPolylines(
    data = 
      coyote_branch_1 %>% 
      st_transform(4326),
    weight = 3,
    opacity = 0.7,
    dashArray = "2, 5",
    color = "#ffff00",
    label = ~ name
  ) %>%
  addPolylines(
    data = 
      coyote_branch_2 %>% 
      st_transform(4326),
    weight = 3,
    opacity = 0.7,
    dashArray = "2, 5",
    color = "#00ffff",
    label = ~ name
  ) %>%
  addPolylines(
    data =
      coyote_branch_3 %>%
      st_transform(4326),
    weight = 3,
    opacity = 0.7,
    dashArray = "2, 5",
    color = "#00ff00",
    label = ~ name
  ) %>% 
  addPolylines(
    data =
      paths_averaged %>%
      filter(name == "coyote_path_1") %>% 
      st_transform(4326),
    weight = 3,
    opacity = 0.7,
    dashArray = "2, 5",
    color = "#ff0000",
    label = ~ name
  ) 


# Combine -----------------------------------------------------------------

paths_combined <- 
  paths_averaged %>% 
  filter(
    !str_detect(name, "path_[23]")
  ) %>% 
  bind_rows(
    coyote_branch_1,
    coyote_branch_2,
    coyote_branch_3
  ) %>% 
  mutate(
    name = 
      if_else(
        !str_detect(name, "coyote"),
        str_c("coyote_", name),
        name
      )
  )
