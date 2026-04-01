
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

# Get and pre-process land cover:

lc_start <-
  terra::rast(
    "data/warr_51187_lulc_2021_2024-Edition.tif"
  )

# Subset and re-project:

lc <-
  lc_start %>% 
  terra::crop(
    terra::ext(-78.18, -78.131, 38.875, 38.903) %>% 
      terra::vect( "epsg:4326") %>% 
      terra::project(
        y = terra::crs(lc_start)
      )
  ) %>% 
  terra::project(
    y = "epsg:32618",
    method = "near"
  )

xml2::read_xml("data/lulc_2024-Edition.xml")

# functions ---------------------------------------------------------------

## basic map for checking -------------------------------------------------

make_map <-
  function(patch_layer = patches) {
    leaflet() %>% 
      
      # Add background layer with a deep zoom:
      
      addProviderTiles(
        "Esri.WorldImagery",
        options = providerTileOptions(maxZoom = 21)
      ) %>% 
      
      # Add the polygons:
      
      addPolygons(
        data = patch_layer,
        group = "patches",
        fillColor = "#eee",
        fillOpacity = 0.5
      ) %>% 
      
      # Add GPS points for coverboard:
      
      leaflet::addCircles(
        data = coverboards_gps,
        radius = 3,
        weight = 1,
        opacity = 1,
        fillOpacity = 1,
        fillColor = "#ff0",
        color = "#000"
      ) %>% 
      
      # Add GPS points for coyote_line:
      
      leaflet::addCircles(
        data = coyote_line,
        radius = 3,
        weight = 1,
        opacity = 1,
        fillOpacity = 1,
        fillColor = "#ff0",
        color = "#000"
      )
  }

## area calculator --------------------------------------------------------

# You can/should ignore me, I'm written in JavaScript:

add_area_display <- 
  function(
    map,
    target_ha = 1, 
    position = "bottomright"
  ) {
    
    htmlwidgets::onRender(
      map,
      sprintf("
      function(el, x) {
        var map = this;
        var targetHa = %f;

        var script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/@turf/turf@6/turf.min.js';
        document.head.appendChild(script);

        var areaControl = L.control({ position: '%s' });

        areaControl.onAdd = function() {
          this._div = L.DomUtil.create('div');
          this._div.style.cssText = [
            'background: white',
            'padding: 8px 14px',
            'border-radius: 5px',
            'border: 1px solid #aaa',
            'font-size: 14px',
            'font-family: Arial, sans-serif',
            'min-width: 160px',
            'text-align: center'
          ].join(';');
          this._div.innerHTML = '<i>Edit a polygon<br>to see its area</i>';
          return this._div;
        };

        areaControl.addTo(map);

        function updateDisplay(ha) {
          var diff = Math.abs(ha - targetHa);
          var pct  = ((ha / targetHa) * 100).toFixed(1);
          var m2   = Math.round(ha * 10000);
          var bg   = diff < 0.05 ? '#c8f5c8' : diff < 0.15
          ? '#fff3b0' : '#ffc8c8';

          areaControl._div.style.background = bg;
          areaControl._div.innerHTML =
            '<b>' + ha.toFixed(4) + ' ha</b>' +
            '<br>' + m2.toLocaleString() + ' m\\u00B2' +
            '<br><span style=\"font-size:12px;color:#555\">' +
            pct + '%% of ' + targetHa + ' ha target</span>';
        }

        map.on('draw:editvertex', function(e) {
          if (typeof turf === 'undefined' || !e.poly) return;
          var area = turf.area(e.poly.toGeoJSON());
          updateDisplay(area / 10000);
        });

        map.on('draw:edited', function(e) {
          if (typeof turf === 'undefined') return;
          e.layers.eachLayer(function(layer) {
            var area = turf.area(layer.toGeoJSON());
            updateDisplay(area / 10000);
          });
        });

        map.on('draw:editstop', function() {
          areaControl._div.style.background = 'white';
          areaControl._div.innerHTML = 
          '<i>Edit a polygon<br>to see its area</i>';
        });
      }
    ", target_ha, position)
    )
  }

# GPS files ---------------------------------------------------------------

coverboards_gps <-
  list.files("data/coverboard_gps/", full.names = TRUE) %>% 
  map_df(
    ~ st_read(
      .x, 
      quiet = TRUE,
      layer = "waypoints"
    )
  ) %>% 
  select(
    name, 
    elevation = ele, 
    datetime = time
  )

coyote_line <-
  st_read(
    "data/Waypoints_26-MAR-26.gpx",
    quiet = TRUE,
    layer = "waypoints"
  ) %>% 
  select(
    name,
    elevation = ele,
    datetime = time
  )

# KMZ files (Google Earth) ------------------------------------------------

# Google Earth KMZ to KML:

unzip(
  "data/nest_study_google_earth.kmz",
  exdir = "data"
)

# Get patches:

patches <- 
  st_read(
    "data/doc.kml", 
    layer = "patches",
    quiet = TRUE
  ) %>% 
  
  # Remove the patch that no longer has shrubs:
  
  filter(Name != "racetrack_sw")

# For each patch, read in the file that represents where we intended to place
# the coverboards:

coverboard_placement <-
  patches %>% 
  pull(Name) %>% 
  str_c("_cb") %>% 
  
  # Read in the files:
  
  map_df(
    ~ st_read(
      "data/doc.kml", 
      layer = .x,
      quiet = TRUE
    )   
  )

# Clean files:

lst(patches, coverboard_placement) %>% 
  map(
    ~ janitor::clean_names(.x) %>% 
      select(name) %>% 
      
      # Strip Google Earth's weird altitude class (POLYGON Z):
      
      st_zm(polyZ, drop = TRUE)
  ) %>% 
  list2env(.GlobalEnv)

# Delete the temporary KML:

file.remove("data/doc.kml")

# who wants to do all of that work? ---------------------------------------

# Write files:

lst(
  coverboards_gps, 
  coverboard_placement,
  patches
) %>% 
  imap(
    ~ write_sf(
      .x,
      str_c(
        "data/", 
        .y, 
        ".geojson"
      ),
      quiet = TRUE,
      delete_dsn = TRUE
    )
  )

# exploring layers --------------------------------------------------------

coverboard_placement <- st_read("data/coverboard_placement.geojson")

coverboards_gps <- st_read("data/coverboards_gps.geojson")

patches <- st_read("data/patches.geojson")

# A tmap bug means we have to combine the cover board points:

coverboards_all <-
  coverboard_placement %>% 
  mutate(position = "intended") %>% 
  bind_rows(
    coverboards_gps %>% 
      mutate(position = "gps")
  )

# Basemap:

tm_basemap(
  c("Esri.WorldImagery", "Esri.WorldTopoMap")
) +
  
  # Patches:
  
  tm_shape(patches, name = "Patches") + 
  tm_polygons(fill_alpha = 0.5) +
  
  # Coverboards:
  
  tm_shape(coverboards_all, name = "Coverboards") +
  tm_dots(
    fill = "position",
    fill.scale = 
      tm_scale_categorical(
        values = c("red", "yellow"),
        levels = c("intended", "gps")
      ),
    lty = 1,
    lwd = 1,
    size = 0.6
  )

# create a leaflet map ----------------------------------------------------

my_map <-
  leaflet() %>% 
  
  # Add background layer with a deep zoom:
  
  addProviderTiles(
    "Esri.WorldImagery",
    options = providerTileOptions(maxZoom = 21)
  ) %>% 
  
  # Add the polygons:
  
  addPolygons(
    data = patches,
    group = "patches",
    fillColor = "#eee",
    fillOpacity = 0.5
  ) %>% 
  
  # Add GPS points for coverboard:
  
  leaflet::addCircles(
    data = coverboards_gps,
    radius = 3,
    weight = 1,
    opacity = 1,
    fillOpacity = 1,
    fillColor = "#ff0",
    color = "#000"
  ) %>% 
  
  # Add the old points for setup:
  
  leaflet::addCircles(
    data = coverboard_placement,
    radius = 3,
    weight = 1,
    opacity = 1,
    fillOpacity = 1,
    fillColor = "#f00",
    color = "#000"
  )

my_map

# editing polygons --------------------------------------------------------

# Here's what you do:

# 1. Run the below to generate the leaflet map
# 2. Zoom into your target patch
# 3. Click the edit button
# 4. Drag the points to wherever you want (it adds points dynamically)
# 5. Click "Save" if you like it and "Cancel" if you don't
# 6. Click "Done" when you are done editing
# 7. Check your results

patches_edited <-
  
  # Target a patch and use my function for mapping:
  
  patches_edited %>% 
  make_map() %>%  
  
  # Add the editing toolbar:
  
  addDrawToolbar(
    targetGroup = "patches",
    
    # We don't want the options for drawing new shapes:
    
    polylineOptions = FALSE,
    polygonOptions = FALSE,
    circleOptions = FALSE,
    rectangleOptions = FALSE,
    markerOptions = FALSE,
    circleMarkerOptions = FALSE,
    
    # We do want editing options:
    
    editOptions = editToolbarOptions()
  ) %>% 
  
  # Add the area display:
  
  add_area_display() %>% 
  
  # Get returns for the edited content:
  
  mapedit::editMap() %>% 
  pluck("all")

# Check whether it worked:

make_map(patches_edited)

patches_named <-
  patches_edited %>% 
  mutate(
    patch_name = 
      c(
        "firehouse",
        "forest_a",
        "forest_b",
        "grassland_a",
        "grassland_b_fence",
        "grassland_b",
        "banding",
        "early_succ",
        "forest_geo",
        "coyote",
        "leech"
      )
  )

# centroids ---------------------------------------------------------------

# Goal is to choose a point within the patch that is:
# * Inside the patch
# * Greater than 5 m from the patch edge
# * As close as possible to the centroid

# Get a focal patch:

focal_patch <-
  patches_named %>% 
  filter(patch_name == "forest_a") %>% 
  st_transform(32618)

# Make an inner-patch to subset to areas greater than 5 meters from the
# boundary:

inner_patch <-
  focal_patch %>% 
  st_buffer(dist = -5)

# Determine camera position:

camera_position <- 
  
  # Sample within the patch at 1 point per meter:
  
  inner_patch %>% 
  st_make_grid(
    cellsize = 1,
    what = "centers"
  ) %>% 
  st_as_sf() %>% 
  st_filter(inner_patch) %>% 
  
  # Subset to the point closes to the centroid
  
  slice_min(
    n = 1,
    order_by = 
      st_distance(
        ., 
        st_centroid(focal_patch)
      ),
    with_ties = FALSE
  )

# Just a check:

tm_shape(focal_patch) +
  tm_polygons() +
  tm_shape(camera_position) +
  tm_dots()

# point count location ----------------------------------------------------

# Goal is to choose a point within the patch that is:
# * Outside the patch
# * 25 m from the patch edge
# * As close as possible to the centroid

# Get a focal patch:

focal_patch <-
  patches_named %>% 
  filter(patch_name == "coyote") %>% 
  st_transform(32618)

# Calculate the geographic center of the focal patch:

centroid <-
  focal_patch %>% 
  st_centroid()

# Buffer to 25 m from the patch edge:

patch_buffer <-
  focal_patch %>% 
  st_buffer(dist = 25)

# Convert the boundary of the buffer to points:

buffer_points <-
  patch_buffer %>% 
  st_boundary() %>% 
  st_cast("LINESTRING") %>% 
  st_line_sample(
    density = 1,
    type = "regular"
  ) %>% 
  st_cast("POINT") %>% 
  st_as_sf() %>% 
  
  # Add land cover:
  
  mutate(
    lc = 
      terra::extract(lc, .) %>% 
      pull()
  ) %>% 
  
  # Subset LC to turf grass (27), natural succession (43 - 44), and pasture/hay
  # (86):
  
  filter(
    lc %in% c(27, 43:44, 86)
  )

# Determine point count position:

point_count_position <- 
  buffer_points %>% 
  
  # Subset to the point closes to the centroid
  
  slice_min(
    n = 1,
    order_by = 
      st_distance(
        ., 
        st_centroid(focal_patch)
      ),
    with_ties = FALSE
  )  


# Just a check:

tm_shape(focal_patch) +
  tm_polygons() +
  point_count_position %>% 
  tm_shape() +
  tm_dots()

# old below here ----------------------------------------------------------



# Convert the patch to a raster with a 1-meter resolution:

patch_raster <-
  focal_patch %>% 
  terra::rast(res = 1) %>% 
  terra::setValues(values = 1)

# Get the focal patch boundary:

focal_patch_boundary <-
  focal_patch %>% 
  st_cast("LINESTRING")

# Calculate the distance to edge:

rast_dist <-
  patch_raster %>% 
  terra::distance(focal_patch_boundary) %>% 
  terra::mask(focal_patch)

# Pretend it's like a watershed (but in reverse) and calculate flow direction:

flow_dir <-
  terra::terrain(-rast_dist, v = "flowdir")

# Calculate flow accumulation:

flow_acc <-
  terra::flowAccumulation(flow_dir)

# Define a threshold for the skeleton:

threshold <- 
  quantile(
    terra::values(flow_acc),
    0.99
  )

# Mask the raster cells to the skeleton:

skeleton_mask <- 
  { flow_acc > threshold } %>% 
  terra::classify(
    cbind(0, NA)
  )

# Convert to points:

skeleton_points <- 
  terra::as.points(skeleton_mask) %>% 
  st_as_sf()

# Define the within-shape centroid (camera position):

patch_center <-
  skeleton_points %>% 
  mutate(
    dist_to_edge = 
      st_distance(
        skeleton_points,
        st_cast(focal_patch, "LINESTRING")
      ) %>% 
      as.numeric(),
    dist_to_centroid = 
      skeleton_points %>% 
      st_distance(centroid) %>% 
      as.numeric()
  ) %>% 
  
  # Subset to points > 5 meters from the patch edge
  
  filter(dist_to_edge > 5) %>% 
  
  # Subset to the point that is closest to the centroid:
  
  slice_min(order_by = dist_to_centroid)

# Have a look:

tm_basemap("Esri.WorldImagery") +
  
  # Patch polygon: 
  
  tm_shape(focal_patch) +
  tm_polygons() +
  
  # Patch skeleton:
  
  tm_shape(skeleton_points) +
  tm_dots() +
  tm_shape(patch_center) +
  tm_dots(
    fill = "red",
    size = 1.25
  )

