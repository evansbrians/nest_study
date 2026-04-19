
# setup -------------------------------------------------------------------

# The bread-and-butter:

library(sf)
library(tmap)
library(tidyverse)

tmap_mode("view")

path_spatial <-
  "pre-field_season/data/spatial/proc"

# get and process data ----------------------------------------------------

# Read and pre-process patch data:

patches <- 
  list.files(
    path_spatial,
    pattern = "edited_[0-9]{1,2}_"
  ) %>% 
  map(
    ~ file.path(path_spatial, .x) %>% 
      st_read(quiet = TRUE) %>% 
      filter(
        name == str_remove_all(.x, ".*[0-9]{1,2}_|\\.geojson")
      )
  ) %>% 
  bind_rows() %>% 
  st_transform(32618)

# Read and pre-process land cover data:

lc <- 
  file.path(path_spatial, "lc_scbi.tif") %>% 
  terra::rast() %>% 
  terra::project(
    y = "epsg:32618",
    method = "near"
  )

# raster processing -------------------------------------------------------

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

# Generate a raster that represents the distance to open habitat:

open_dist <-
  terra::distance(lc_grass_shrub)

# nest camera locations ---------------------------------------------------

# Goal is to choose a point within the patch that is:
# * Inside the patch
# * Greater than 5 m from the patch edge
# * As close as possible to the centroid

## example with a single focal patch --------------------------------------

# Get a focal patch (example):

focal_patch <-
  patches %>% 
  filter(name == "forest_a")

# Make an inner-patch to subset to areas greater than 5 meters from the
# boundary:

inner_patch <-
  focal_patch %>% 
  
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
  
  # Subset to points that are within 10 m of an open habitat boundary? Check 
  # with T if she wants this:
  
  mutate(
    dist_to_open = 
      terra::extract(open_dist, .) %>% 
      pull()
  ) %>% 
  filter(dist_to_open < 10)

# Have a look:

tm_basemap("Esri.WorldImagery") +
  tm_shape(focal_patch) + 
  tm_polygons(fill_alpha = 0.4) +
  tm_shape(inner_patch) +
  tm_dots(size = 0.05)

# Determine camera position by subsetting the points to the point that is
# closest to the centroid (no `warn` option ... even more annoying):

camera_position <- 
  inner_patch %>% 
  slice_min(
    n = 1,
    order_by = 
      st_distance(
        ., 
        suppressWarnings(
          st_centroid(focal_patch)
        )
      ),
    with_ties = FALSE
  )

# Have a look:

tm_basemap("Esri.WorldImagery") +
  tm_shape(focal_patch) + 
  tm_polygons(fill_alpha = 0.4) +
  tm_shape(inner_patch) +
  tm_dots(size = 0.05) +
  
  # Add camera location and centroid:
  
  list(
    camera_position, 
    st_centroid(focal_patch)
  ) %>% 
  bind_rows() %>% 
  st_sf() %>% 
  mutate(
    name = c("camera", "centroid")
  ) %>% 
  tm_shape(name = "center points") +
  tm_dots(
    fill = "name",
    fill.scale = 
      tm_scale_categorical(
        values = c("yellow", "red")
      ),
    size = 0.40
  )

## camera locations for all of the patches at once ------------------------

camera_locations <- 
  patches %>% 
  group_split(name) %>% 
  map(
    \(.focal_patch) {
      
      # Calculate inner patch boundary and convert to points:
      
      .focal_patch %>% 
        st_buffer(dist = -5) %>% 
        st_cast("MULTILINESTRING") %>% 
        st_cast("LINESTRING", warn = FALSE) %>% 
        st_line_sample(
          density = 1,
          type = "regular"
        ) %>% 
        st_cast("POINT") %>% 
        st_sf() %>% 
        
        # Subset to points that are within 10 m of an open habitat (check)?
        
        mutate(
          dist_to_open = 
            terra::extract(open_dist, .) %>% 
            pull()
        ) %>% 
        filter(dist_to_open < 10) %>% 
        
        # Get point on boundary closest to the centroid:
        
        slice_min(
          n = 1,
          order_by = 
            st_distance(
              ., 
              suppressWarnings(
                st_centroid(.focal_patch)
              )
            ),
          with_ties = FALSE
        ) %>% 
        
        # Add the patch_name:
        
        mutate(
          name = .focal_patch$name,
          .before = 1
        )
    }
  ) %>% 
  bind_rows()

# Have a look:

tm_basemap("Esri.WorldImagery") +
  tm_shape(patches) + 
  tm_polygons(fill_alpha = 0.4) +
  tm_shape(camera_locations) +
  tm_dots(
    fill = "yellow",
    size = 0.4
  )

# point count location ----------------------------------------------------

# Goal is to choose a point within the patch that is:
# * Outside the patch
# * 25 m from the patch edge
# * As close as possible to the centroid

## example with a single focal patch --------------------------------------

# Get a focal patch:

focal_patch <-
  patches %>% 
  filter(name == "forest_b")

# Get points that are 25 m from a patch boundary:

outer_patch <-
  focal_patch %>% 
  
  # Buffer to 25 m from the patch edge (check distance with Tara):
  
  st_buffer(dist = 25) %>% 
  st_boundary() %>% 
  st_cast("LINESTRING", warn = FALSE) %>% 
  
  # Convert the boundary of the buffer to points:
  
  st_line_sample(
    density = 1,
    type = "regular"
  ) %>% 
  st_cast("POINT") %>% 
  st_sf() %>% 
  
  # Subset to points that are within open habitat:
  
  mutate(
    dist_to_open = 
      terra::extract(open_dist, .) %>% 
      pull()
  ) %>% 
  filter(dist_to_open == 0)

# Have a look:

tm_basemap("Esri.WorldImagery") +
  tm_shape(focal_patch) + 
  tm_polygons(fill_alpha = 0.4) +
  tm_shape(outer_patch) +
  tm_dots(size = 0.05)

# Determine point count position:

point_count_position <- 
  outer_patch %>% 
  
  # Subset to the point closes to the centroid:
  
  slice_min(
    n = 1,
    order_by = 
      st_distance(
        ., 
        suppressWarnings(
          st_centroid(focal_patch)
        )
      ),
    with_ties = FALSE
  )  

# Just a check:

tm_basemap("Esri.WorldImagery") +
  tm_shape(focal_patch) +
  tm_polygons() +
  
  # Add camera location and centroid:
  
  list(
    point_count_position, 
    st_centroid(focal_patch)
  ) %>% 
  bind_rows() %>% 
  st_sf() %>% 
  mutate(
    name = c("point count", "centroid")
  ) %>% 
  tm_shape(name = "center points") +
  tm_dots(
    fill = "name",
    fill.scale = 
      tm_scale_categorical(
        values = c("red", "yellow")
      ),
    size = 0.40
  )

## point count locations for all of the patches at once -------------------

point_count_locations <- 
  patches %>% 
  group_split(name) %>% 
  map(
    \(.focal_patch) {
      
      # Calculate inner patch boundary and convert to points:
      
      .focal_patch %>% 
        st_buffer(dist = 25) %>% 
        st_cast("LINESTRING", warn = FALSE) %>% 
        
        # Convert the boundary of the buffer to points:
        
        st_line_sample(
          density = 1,
          type = "regular"
        ) %>% 
        st_cast("POINT") %>% 
        st_sf() %>% 
        
        # Subset to points that are within open habitat:
        
        mutate(
          dist_to_open = 
            terra::extract(open_dist, .) %>% 
            pull()
        ) %>% 
        filter(dist_to_open == 0) %>% 
        
        # Get point on boundary closest to the centroid:
        
        slice_min(
          n = 1,
          order_by = 
            st_distance(
              ., 
              suppressWarnings(
                st_centroid(.focal_patch)
              )
            ),
          with_ties = FALSE
        ) %>% 
        
        # Add the patch_name:
        
        mutate(
          name = .focal_patch$name,
          .before = 1
        )
    }
  ) %>% 
  bind_rows()

# Have a look:

tm_basemap("Esri.WorldImagery") +
  tm_shape(patches) + 
  tm_polygons(fill_alpha = 0.4) +
  tm_shape(point_count_locations) +
  tm_dots(
    fill = "yellow",
    size = 0.4
  )

# write to file -----------------------------------------------------------

camera_locations %>% 
  st_write(
    file.path(path_spatial, "trailcam_locations.geojson"),
    delete_dsn = TRUE
  )

point_count_locations %>% 
  st_write(
    file.path(path_spatial, "point_count_locations.geojson"),
    delete_dsn = TRUE
  )
