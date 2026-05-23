# Script for determining the locations of the two additional trailcams to each
# patch.

# setup -------------------------------------------------------------------

# The bread-and-butter:

library(sf)
library(tmap)
library(tidyverse)

tmap_mode("view")

# Read in shapefiles:

patches <-
  st_read("data/spatial/patches.geojson", quiet = TRUE) %>% 
  st_transform(32618)

trailcams <-
  st_read("data/spatial/trailcam_locations.geojson", quiet = TRUE) %>% 
  mutate(
    name = str_remove(name, "_trail.*")
  ) %>% 
  st_transform(32618)

# Read land cover data:

lc <- 
  terra::rast("data/spatial/lc_scbi.tif") %>% 
  terra::project(
    y = "epsg:32618",
    method = "near"
  )

# raster processing -------------------------------------------------------

# Note: This section is identical to raster processing in
# trailcam_pcount_locations.R

# Get levels that are not associated with forest

grass_shrub_classes <-
  terra::levels(lc)[[1]] %>% 
  as_tibble() %>% 
  filter(
    str_detect(class, "Herb|Grass|Barr|Shrub")
  )

# Subset the raster to non-forest pixels:

lc_grass_shrub <-
  lc %>% 
  terra::subst(
    from = grass_shrub_classes$class,
    to = grass_shrub_classes$class,
    others = NA
  )

# Have a look:

tm_basemap("Esri.WorldImagery") +
  tm_shape(lc_grass_shrub) +
  tm_raster(col_alpha = 0.7) +
  tm_shape(patches) +
  tm_polygons(
    col = "yellow",
    fill_alpha = 0.30
  )

# Generate a raster that represents the distance to open habitat:

open_dist <-
  terra::distance(lc_grass_shrub) %>% 
  
  # We are only interested in distance-to-open values near patches:
  
  terra::crop(
    patches %>% 
      st_buffer(dist = 30),
    mask = TRUE
  )

# Have a look:

tm_basemap("Esri.WorldImagery") +
  tm_shape(open_dist) +
  tm_raster(
    col.scale =
      tm_scale_continuous(values = "panoply")
  ) +
  tm_shape(patches) +
  tm_polygons(
    col = "black",
    fill_alpha = 0.30
  )

# patch boundaries to points ----------------------------------------------

inner_patch_points <-
  patches %>% 
  
  # Inner buffer 5 m from the patch boundary:
  
  st_buffer(dist = -5) %>% 
  
  # Cast buffer to a multiline string:
  
  st_cast("MULTILINESTRING") %>% 
  
  # Cast the multiline string to a linestring (setting warnings to FALSE here
  # because they're annoying and not useful):
  
  st_cast("LINESTRING", warn = FALSE) %>% 
  
  # Generate points every 1 meter along the inner buffer:
  
  st_line_sample(
    density = 1,
    type = "regular"
  ) %>% 
  
  # Cast from MULTIPOINT to single points:
  
  st_cast("POINT") %>% 
  
  # Convert to an sf:
  
  st_sf() %>% 
  
  # Add the names back in:
  
  st_join(patches) %>% 
  
  # Subset to points that are within 11 m of an open habitat boundary:
  
  mutate(
    dist_to_open = 
      terra::extract(open_dist, .) %>% 
      pull()
  ) %>% 
  filter(dist_to_open < 11)

# Have a look:

tm_basemap("Esri.WorldImagery") +
  tm_shape(patches) + 
  tm_polygons(fill_alpha = 0.4) +
  tm_shape(inner_patch_points) +
  tm_dots(
    size = 0.20, 
    fill = "yellow"
  ) +
  tm_shape(trailcams) +
  tm_dots(
    size = 0.40,
    fill = "blue"
  )

# distances from trailcam_0 -----------------------------------------------

add_cams <-
  patches %>% 
  pull(name) %>% 
  map_dfr(
    \(.focal_patch_name) {
      
      # Get the inner patch points associated with just the focal patch:
      
      patch_points_focal <-
        inner_patch_points %>% 
        filter(name == .focal_patch_name)
      
      # Make a numeric vector of distances between each point and the location
      # of the trailcam at the centroid:
      
      cam_distance <-
        st_distance(
          patch_points_focal, 
          trailcams %>% 
            filter(name == .focal_patch_name)
        ) %>% 
        as.numeric()
      
      # Make a matrix of all pairwise distances between points:
      
      dist_matrix <- st_distance(patch_points_focal, patch_points_focal)
      
      # Determine the pair of points that maximizes distances:
      
      best_pair <-
        map_dfr(
          seq_len(
            nrow(dist_matrix)
          ),
          \(.i) {
            
            # Maximize the sum of pairwise distances between points and the
            # centroid trailcam and points and themselves:
            
            distance_sums <- 
              cam_distance[.i] + 
              cam_distance + 
              as.numeric(dist_matrix[.i, ])
            
            # Exclude self-pairing:
            
            distance_sums[.i] <- -Inf
            
            # Get the row ids for each distance measure:
            
            tibble(
              cam1_id = .i,
              cam2_id = which.max(distance_sums),
              maximized_distance = max(distance_sums)
            )
          }
        ) %>%
        slice_max(
          maximized_distance, 
          n = 1,
          with_ties = FALSE
        )
      
      # Subset points:
      
      patch_points_focal %>% 
        slice(
          c(
            best_pair$cam1_id,
            best_pair$cam2_id
          )
        ) %>% 
        
        # Add trailcam names:
        
        mutate(
          name =
            name %>% 
            str_c("_trailcam_", 1:2)
        ) %>% 
        select(!dist_to_open)
    }
  )

# Have a look:

tm_basemap("Esri.WorldImagery") +
  tm_shape(patches) + 
  tm_polygons(fill_alpha = 0.4) +
  tm_shape(inner_patch_points) +
  tm_dots(
    size = 0.20, 
    fill = "yellow"
  ) +
  tm_shape(trailcams) +
  tm_dots(
    size = 0.40,
    fill = "blue"
  ) +
  tm_shape(add_cams) +
  tm_dots(
    size = 0.40,
    fill = "red"
  )

# write to file -----------------------------------------------------------

add_cams %>% 
  bind_rows(
    st_read("data/spatial/trailcam_locations.geojson", quiet = TRUE) %>% 
      st_transform(32618) %>% 
      select(
        !c(elevation, datetime)
      )
  ) %>% 
  st_write(
    "data/spatial/trailcam_locations.geojson",
    delete_dsn = TRUE
  )


