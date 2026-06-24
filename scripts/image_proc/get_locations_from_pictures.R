
# Get location information from photos

# setup -------------------------------------------------------------------

library(sf)
library(glue)
library(tidyverse)

source("scripts/utils/functions/utility_functions.R")

# Spatial data:

list.files(
  here::here("data/spatial"),
  pattern = "geojson",
  full.names = TRUE
) %>%
  set_names_from_path() %>%
  set_names(
    names(.) %>% 
      str_remove("_locations") %>% 
      str_replace("(?<!s)$", "s")
  ) %>% 
  map(
    ~ st_read(.x, quiet = TRUE) %>%
      st_transform(4326) %>% 
      
      # Add icon ids:
      
      mutate(
        icon_id = 
          case_when(
            str_detect(name, "cb|cam") ~ 
              str_extract(name, "(cb|cam)_[0-6]$"),
            str_detect(name, "^N") ~ "nest",
            str_detect(name, "^point") ~ "pc",
            .default = "patch"
          ),
        .after = name
      )
  ) %>% 
  list2env(.GlobalEnv)

# Get image file metadata:

meta <- 
  exifr::read_exif("data/photos", recursive = TRUE)

# process image metadata --------------------------------------------------

nest_photos <-
  meta %>% 
  janitor::clean_names() %>% 
  select(
    matches("^(source|gps)")
  ) %>% 
  mutate(
    source_file,
    uri = 
      source_file %>% 
      map(
        ~ base64enc::dataURI(file = .x, mime = "image/png")
      ),
    datetime = 
      as_datetime(gps_date_time) %>% 
      with_tz("America/New_York"),
    lon = gps_longitude,
    lat = gps_latitude,
    positiion_error = gpsh_positioning_error,
    elevation = gps_altitude,
    bearing = gps_dest_bearing,
    popup_content = glue("<img src='{uri}' style='width:250px;'>"),
    .keep = "none"
  ) %>% 
  arrange(datetime) %>% 
  st_as_sf(
    coords = c("lon", "lat"),
    crs = 4326
  )

# view on map -------------------------------------------------------------

leaflet() %>%
  
  # Base tile layers:
  
  addProviderTiles(
    providers$Esri.WorldImagery,
    group = "Satellite",
    options = tileOptions(maxZoom = 21)
  ) %>%
  
  # Patches drawn first so point layers render on top:
  
  addPolygons(
    data = patches,
    fillColor = "#ffffff",
    fillOpacity = 0.2,
    color = "#0000ff",
    weight = 1.5,
    opacity = 0.5,
    popup = ~ name,
    label = ~ name,
    group = "Patches"
  ) %>% 
  
  # Add the nest locations:
  
  addMarkers(
    data = nest_photos,
    popup = ~ popup_content,
    label = ~ datetime
  )

# add to nest shapefile ---------------------------------------------------

current_nests <- 
  st_read("data/spatial/nest_locations.geojson")

nest_photos %>% 
  filter(
    as_date(datetime) == "2026-06-17"
  ) %>% 
  mutate(name = "N088") %>% 
  select(
    name,
    elevation,
    datetime
  ) %>% 
  st_write("data/spatial/nest_locations.geojson", append = TRUE)



