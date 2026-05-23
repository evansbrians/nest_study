# Create an interactive leaflet map for hosting on GitHub pages

# setup -------------------------------------------------------------------

library(leaflet)
library(sf)
library(tidyverse)
library(htmlwidgets)

source("scripts/functions.R")

# Spatial data:

list.files(
  "data/spatial",
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

# Icons:

icons <-
  list.files("icons/map_icons", full.names = TRUE) %>% 
  set_names_from_path() %>% 
  map(
    ~ makeIcon(
      iconUrl = .x,
      iconWidth = 26,
      iconHeight = 26,
      iconAnchorX = 13,
      iconAnchorY = 26
    )
  ) %>% 
  do.call(iconList, .)

# build map ---------------------------------------------------------------

map <-
  leaflet() %>%
  
  # Base tile layers:
  
  addProviderTiles(
    providers$Esri.WorldImagery,
    group = "Satellite",
    options = tileOptions(maxZoom = 21)
  ) %>%
  addProviderTiles(
    providers$OpenStreetMap,
    group = "Street Map"
  ) %>%
  
  # Patches drawn first so point layers render on top:
  
  addPolygons(
    data = patches,
    fillColor = "#ffffff",
    fillOpacity = 0.3,
    color = "#0000ff",
    weight = 1.5,
    opacity = 0.5,
    popup = ~ name,
    label = ~ name,
    group = "Patches"
  ) %>%
  
  # Coverboards:
  
  addMarkers(
    data = coverboards,
    icon = ~ icons[icon_id],
    popup = ~ name,
    label = ~ name,
    group = "Coverboards"
  ) %>%
  
  # Trail cameras:
  
  addMarkers(
    data = trailcams,
    icon = ~ icons[icon_id],
    popup = ~ name,
    label = ~ name,
    group = "Trail Cameras"
  ) %>%
  
  # Point counts:
  
  addMarkers(
    data = point_counts,
    icon = icons["pc"],
    popup = ~ name,
    label = ~ name,
    group = "Point Counts"
  ) %>%
  
  # Layer control:
  
  addLayersControl(
    baseGroups = c("Satellite", "Street Map"),
    overlayGroups = 
      c(
        "Patches",
        "Coverboards",
        "Trail Cameras",
        "Point Counts"
      ),
    options = layersControlOptions(collapsed = FALSE)
  ) %>%
  
  # Scale bar for distance reference:
  
  addScaleBar(position = "bottomleft") %>% 
  
  # Hide points unless selected otherwise:
  
  hideGroup(
    c(
      "Coverboards",
      "Trail Cameras", 
      "Point Counts"
    )
  )

# save to HTML ------------------------------------------------------------

saveWidget(
  map,
  file = "outputs/nest_study_map.html",
  selfcontained = FALSE,
  title = "Nest Study Field Map"
)
