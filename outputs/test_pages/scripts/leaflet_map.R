# Create an interactive leaflet map for hosting on GitHub pages

# setup -------------------------------------------------------------------

library(leaflet)
library(sf)
library(htmlwidgets)
library(tidyverse)

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
      iconUrl = base64enc::dataURI(file = .x, mime = "image/png"),
      iconWidth = 26,
      iconHeight = 26,
      iconAnchorX = 13,
      iconAnchorY = 26
    )
  ) %>% 
  do.call(iconList, .)

# nest status -------------------------------------------------------------

# Read and process nest data for map:

nests_coded <- 
  read_rds("data/field_data.rds") %>% 
  pluck("nests") %>% 
  unnest(interval_data) %>% 
  mutate(
    nest_id, 
    patch_id, 
    nest_fate, 
    date = as_date(date),
    across(
      host_eggs:host_young,
      ~ as.numeric(.x)
    ),
    .keep = "none"
  ) %>% 
  slice_max(date, by = nest_id) %>% 
  mutate(
    name = nest_id,
    icon_id = 
      case_when(
        nest_fate %in% c("Success", "Failure") ~ "nest_old",
        host_eggs == 0 & 
          host_young == 0 ~  "nest_building",
        is.na(host_eggs) & is.na(host_young) ~ "nest_unknown",
        .default = "nest_active"
      ),
    .keep = "none"
  ) %>% 
  left_join(
    select(nests, !icon_id),
    .,
    by = "name"
  )

# Simplify path lines

paths <-
  tracks %>% 
  rmapshaper::ms_simplify(keep = 0.20)

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
    fillOpacity = 0.2,
    color = "#0000ff",
    weight = 1.5,
    opacity = 0.5,
    popup = ~ name,
    label = ~ name,
    group = "Patches"
  ) %>%
  
  addPolylines(
    data = paths,
    weight = 3,
    opacity = 0.7,
    dashArray = "2, 5",
    color = "#ffff00"
  ) %>% 
  
  # Nests
  
  addMarkers(
    data = nests_coded,
    icon = ~ icons[icon_id],
    popup = ~ name,
    label = ~ name,
    group = "Nests"
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
        "Point Counts",
        "Nests"
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
      "Point Counts",
      "Nests"
    )
  )

# bigger controls and scale bar -------------------------------------------

map_mobile_friendly <-
  map %>%
  htmlwidgets::prependContent(
    htmltools::tags$style(
      htmltools::HTML(
        read_file("scripts/map_styles.css")
      )
    )
  )

# add location tracking ---------------------------------------------------

map_tracking <-
  map_mobile_friendly %>%
  htmlwidgets::onRender(
    read_file("scripts/map_tracking.js")
  )

# save to HTML ------------------------------------------------------------

saveWidget(
  map_tracking,
  file = "outputs/test_pages/docs/field_map/index.html",
  selfcontained = FALSE,
  title = "Nest Study Field Map"
)

# end session -------------------------------------------------------------

# Update git:

autopush_updates()

# Clear global environment:

rm(
  list = ls()
)
