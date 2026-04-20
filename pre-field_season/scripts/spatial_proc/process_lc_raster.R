# Script for processing the giant Chesapeake Bay LULC raster

# Author: Brian Evans
# Created on: 2026-03-31
# Last modified: 2026-04-01

# Goals:
# * Subset to SCBI campus
# * Projected as UTM Zone 17N (EPSG 32618)
# * Classified with labels

# setup -------------------------------------------------------------------

library(sf)
library(tidyverse)

# Path to files:

path_spatial <- 
  "pre-field_season/data/spatial"

# Read in the full raster:

lc_start <-
  path_spatial %>% 
  file.path("raw/warr_51187_lulc_2021_2024-Edition.tif") %>% 
  terra::rast()

# Read in the patch data:

patches_start <- 
  path_spatial %>% 
  file.path("proc/patches_start.geojson") %>% 
  st_read(quiet = TRUE) %>% 
  st_transform(
    st_crs(lc_start)
  )

# make an extent for cropping ---------------------------------------------

# Make an bounding box polygon, extending patches by 200 m:

patch_extent <-
  patches_start %>% 
  st_buffer(dist = 150) %>% 
  st_bbox() %>% 
  st_as_sfc() %>% 
  st_sf()

# Have a look:

tm_basemap("Esri.WorldImagery") +
  tm_view(set_view = 14) +
  tm_shape(patches_start) +
  tm_polygons() +
  tm_shape(patch_extent) +
  tm_polygons(fill_alpha = 0.25)

# subset and reproject the raster -----------------------------------------

lc <-
  lc_start %>% 
  
  # Crop the raster to the SCBI campus:
  
  terra::crop(patch_extent) %>% 
  
  # Project to UTM:
  
  terra::project(
    y = "epsg:32618",
    method = "near"
  )

# classify the raster -----------------------------------------------------

# Read the XML file for the raster class definitions:

nodes <-
  path_spatial %>% 
  file.path("raw/lulc_2024-Edition.xml") %>% 
  xml2::read_xml() %>% 
  
  # Extract value-definition pairs:
  
  xml2::xml_find_all(".//eainfo/detailed/attr/attrdomv/edom") 

# Convert to a reclass frame:

lc_reclass <- 
  tibble(
    
    # Define raster values:
    
    value = 
      xml2::xml_integer(
        xml2::xml_find_all(nodes, "./edomv")
      ),
    
    # Define labels for values:
    
    class = 
      xml2::xml_text(
        xml2::xml_find_all(nodes, "./edomvd")
      )
  ) %>% 
  
  # Subset to values in the raster:
  
  filter(
    value %in%
      unique(
        terra::values(lc)
      )
  )

# Assign labels to raster classes (ugh, terra is annoying):

levels(lc) <- lc_reclass

# write to file -----------------------------------------------------------

lc %>% 
  terra::writeRaster(
    file.path(path_spatial, "proc/lc_scbi.tif"),
    overwrite = TRUE
  )

# Remove unnecessary files:

rm(
  lc,
  lc_start,
  nodes,
  lc_reclass
)