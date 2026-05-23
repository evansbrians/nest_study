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
      iconUrl = base64enc::dataURI(file = .x, mime = "image/png"),
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

# bigger controls and scale bar -------------------------------------------

map_mobile_friendly <-
  map %>%
  htmlwidgets::prependContent(
    htmltools::tags$style(
      htmltools::HTML(
        "
        /* Layer control panel and all text within it */
        
        .leaflet-control-layers {
          font-size: 24px;
          line-height: 2;
          padding: 8px 12px;
        }

        /* Individual layer labels -- padding increases touch target height */
        
        .leaflet-control-layers label {
          font-size: 24px;
          padding: 4px 0;
          display: flex;
          align-items: center;
        }

        /* Checkboxes and radio buttons -- larger for touch accuracy */
        
        .leaflet-control-layers input[type='checkbox'],
        .leaflet-control-layers input[type='radio'] {
          width: 36px;
          height: 36px;
          margin-right: 8px;
          cursor: pointer;
        }

        /* Separator line between base layers and overlay groups */
        
        .leaflet-control-layers-separator {
          margin: 8px 0;
        }

        /* Scale bar text and border */
        
        .leaflet-control-scale-line {
          font-size: 24px;
          line-height: 1.6;
          padding: 4px 10px;
          border-width: 2px;
        }
        "
      )
    )
  )

# add location tracking ---------------------------------------------------

map_tracking <-
  map_mobile_friendly %>%
  htmlwidgets::onRender(
    "
    function(el, x) {

      // 'this' inside onRender refers to the live leaflet map object:

      var map = this;

      // Assign position marker and accuracy circle to objects:

      var positionMarker  = null;
      var accuracyCircle  = null;

      // Track whether this is the first GPS fix so we can pan your location
      // on load without re-centering every time you move.

      var firstFix = true;

      // Start watching your position.
      // * `watch: true` keeps the listener running continuously rather than
      //    running just once. 
      // * `enableHighAccuracy` requests GPS on devices that have it

      map.locate({
        watch:               true,
        enableHighAccuracy:  true
      });

      // `locationfound` runs each time a new position is available:

      map.on('locationfound', function(e) {

        // Pan to your location on the first fix only. After that, the map stays
        // wherever you scrolled so you can look around without it going back to
        // your location:

        if (firstFix) {
          map.setView(e.latlng, map.getZoom());
          firstFix = false;
        }

        // `e.accuracy` is the GPS uncertainty circle in meters. This will
        // update if the circle already exists and creates it otherwise:

        if (accuracyCircle) {
          accuracyCircle
            .setLatLng(e.latlng)
            .setRadius(e.accuracy);
        } else {
          accuracyCircle = L.circle(e.latlng, {
            radius:      e.accuracy,
            color:       '#136aec',
            fillColor:   '#136aec',
            fillOpacity: 0.15,
            weight:      1,
            interactive: false
          }).addTo(map);
        }

        // `L.circleMarker` stays a fixed pixel size on screen regardless of
        // zoom:

        if (positionMarker) {
          positionMarker.setLatLng(e.latlng);
        } else {
          positionMarker = L.circleMarker(e.latlng, {
            radius:      9,
            color:       '#ffffff',  // white border
            fillColor:   '#136aec',  // blue fill matching the accuracy circle
            fillOpacity: 1,
            weight:      2,
            interactive: false
          }).addTo(map);
        }
      });

      // `locationerror` happens if the browser denies permission or your phone
      // has no location signal.

      map.on('locationerror', function(e) {
        console.warn('Location error: ' + e.message);
      });
    }
    "
  )

# save to HTML ------------------------------------------------------------

saveWidget(
  map_tracking,
  file = "field_map/index.html",
  selfcontained = FALSE,
  title = "Nest Study Field Map"
)
