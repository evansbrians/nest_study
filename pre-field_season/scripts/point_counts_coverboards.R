
# setup -------------------------------------------------------------------

# The bread-and-butter:

library(sf)
library(tmap)
library(tidyverse)

tmap_mode("view")

patches_edited <- st_read("data/spatial/proc/patches_edited.geojson")

# read and pre-process raster data ----------------------------------------

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

# Read the XML file for the raster class definitions:

nodes <-
  xml2::read_xml("data/lulc_2024-Edition.xml") %>% 
  
  # Extract value-definition pairs:
  
  xml2::xml_find_all(".//eainfo/detailed/attr/attrdomv/edom") 

# Convert to a reclass frame:

lc_reclass <- 
  tibble(
    value = 
      xml2::xml_integer(
        xml2::xml_find_all(nodes, "./edomv")
      ),
    class = 
      xml2::xml_text(
        xml2::xml_find_all(nodes, "./edomvd")
      )
  )

# Ugh:

levels(lc) <- lc_reclass

# Remove unnecessary files:

rm(
  lc,
  nodes,
  lc_reclass
)

# nest camera locations ---------------------------------------------------

# Goal is to choose a point within the patch that is:
# * Inside the patch
# * Greater than 5 m from the patch edge
# * As close as possible to the centroid

# Get a focal patch:

focal_patch <-
  patches_edited %>% 
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

tm_basemap("Esri.WorldImagery") +
tm_shape(focal_patch) +
  tm_polygons() +
  tm_shape(camera_position) +
  tm_dots(size = 1.25)

# point count location ----------------------------------------------------

# Goal is to choose a point within the patch that is:
# * Outside the patch
# * 25 m from the patch edge
# * As close as possible to the centroid

# Get a focal patch:

focal_patch <-
  patches_edited %>% 
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
    !str_detect(lc, "Forest")
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

tm_basemap("Esri.WorldImagery") +
  tm_shape(focal_patch) +
  tm_polygons() +
  point_count_position %>% 
  tm_shape() +
  tm_dots(
    fill = "yellow",
    size = 1.25)

