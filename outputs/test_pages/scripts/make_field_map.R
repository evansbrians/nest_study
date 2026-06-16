# Create an interactive leaflet map for hosting on GitHub pages

# setup -------------------------------------------------------------------

library(glue)
library(leaflet)
library(sf)
library(htmlwidgets)
library(htmltools)
library(tidyverse)

source("scripts/functions.R")

root <-  here::here()

# Function to make popup:

make_nest_popup <-
  function(.x) {
    glue_data(
      .x,
      "
      <div style='font-family: Times;'>
      <h3><strong>{nest_id}</strong>. Species: {species}</h3>
      <ul>
      <li><strong>Patch</strong>: {patch_id}</li>
      <li><strong>Plant species</strong>: {substrate}</li>
      <li><strong>Height</strong>: {height}</li>
      <li><strong>Location description</strong>: {location_description}</li>
      <li><strong>Discovered on</strong>: {discovery_date}</li>
      <li><strong>Last checked on</strong>: {last_check}</li>
      <li><strong>Current status</strong>: {last_status}</li>
      </ul>
      </div>
      "
    )
  }

# data gathering and pre-processing ---------------------------------------

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

# Nest data:

nests_start <-
  here::here("data/field_data.rds") %>% 
  read_rds() %>% 
  pluck("nests") %>% 
  unnest(interval_data)

# Icons:

icons <-
  list.files(
    here::here("icons/map_icons"), 
    pattern = "png$",
    full.names = TRUE
  ) %>% 
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

# Simplify path lines:

paths <-
  tracks %>% 
  filter(
    !str_detect(name, "line")
  ) %>% 
  rmapshaper::ms_simplify(keep = 0.20)

# nest status -------------------------------------------------------------

# Read and process nest data for map:

# Nest popup:

nest_popup <- 
  nests_start %>% 
  summarize(
    last_check = last(date), 
    last_status = last(nest_status),
    .by = 
      c(
        nest_id:patch_id, 
        height,
        substrate, 
        location_description,
        discovery_date
      )
  ) %>% 
  mutate(
    across(
      where(is.character),
      ~ replace_na(.x, "Unknown")
    )
  ) %>% 
  split(.$nest_id) %>% 
  imap(
    \(.x, .y) {
      tibble(
        nest_id = .y,
        nest_popup = 
          make_nest_popup(.x) %>% 
          as.character() %>% 
          htmltools::HTML()
      )
    }
  ) %>% 
  bind_rows()

nests_coded <- 
  nests_start %>% 
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
  ) %>% 
  filter(name != "N031") %>% 
  
  # Add nest popup:
  
  left_join(
    nest_popup,
    by = join_by(name == nest_id)
  )

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
    popup = ~ nest_popup,
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
    position = "topright",
    options = layersControlOptions(collapsed = TRUE)
  ) %>%
  
  # Scale bar for distance reference:
  
  addScaleBar(
    position = "bottomleft",
    options = scaleBarOptions(imperial = FALSE)
  ) %>% 
  
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

# Define output location:

map_out <-
  Sys.getenv("QUARTO_PROJECT_OUTPUT_DIR", unset = "docs") %>% 
  file.path("field_map.html")

# Create the directory:

dir.create(
  dirname(map_out),
  recursive = TRUE,
  showWarnings = FALSE
)

saveWidget(
  map_tracking,
  file = map_out,
  selfcontained = FALSE,
  title = "Nest Study Field Map"
)
