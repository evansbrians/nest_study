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

# Read in the full raster:

lc_start <-
  terra::rast(
    "data/spatial/raw/warr_51187_lulc_2021_2024-Edition.tif"
  )

# subset and reproject the raster -----------------------------------------

lc <-
  lc_start %>% 
  
  # Crop the raster to the SCBI campus:
  
  terra::crop(
    
    # Define the extent of SCBI:
    
    terra::ext(
      -78.18,
      -78.131,
      38.875, 
      38.903
    ) %>% 
      
      # Convert to a SpatVector with EPSG 4326:
      
      terra::vect("epsg:4326") %>% 
      terra::project(
        y = terra::crs(lc_start)
      )
  ) %>% 
  
  # Project to UTM:
  
  terra::project(
    y = "epsg:32618",
    method = "near"
  )

# classify the raster -----------------------------------------------------

# Read the XML file for the raster class definitions:

nodes <-
  xml2::read_xml("data/spatial/raw/lulc_2024-Edition.xml") %>% 
  
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

terra::writeRaster(
  lc,
  "data/spatial/proc/lc_scbi.tif"
)

# Remove unnecessary files:

rm(
  lc,
  lc_start,
  nodes,
  lc_reclass
)