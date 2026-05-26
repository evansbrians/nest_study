
# This script automates the process of creating a new KMZ file for online Google
# Earth maps for use in the field.

# setup -------------------------------------------------------------------

library(xml2)
library(sf)
library(tidyverse)

source("scripts/functions.R")

# Remove previous KMZ file, if present:

if (exists("outputs/nest_study.kmz")) {
  file.remove("outputs/nest_study.kmz")
}

# Get shapefiles:

spatial_files <-
  list.files(
    "data/spatial",
    pattern = "geojson$",
    full.names = TRUE
  ) %>%
  set_names_from_path() %>%
  map(
    ~ st_read(.x, quiet = TRUE) %>% 
      st_transform(4326)
  )

# Define icons and their location in the (future) KMZ:

icon_urls <-
  list.files(
    "icons/map_icons",
  ) %>% 
  set_names_from_path() %>% 
  map(
    ~  str_c("files/", .x)
  )

# Build document:

doc <- xml_new_root("kml", xmlns = "http://www.opengis.net/kml/2.2")
root <- xml_add_child(doc, "Document")

# coverboards -------------------------------------------------------------

# Define folder structure:

cb_folder <- xml_add_child(root, "Folder")
xml_add_child(cb_folder, "name", "Coverboards")

# Point file:

cb_pts <-
  spatial_files %>%
  pluck("coverboard_locations") %>%
  mutate(
    cb_value = str_extract(name, "cb_[1-6]$")
  )

# Add points to the KML and style them:

add_icon_styles(cb_folder, cb_pts$cb_value)
add_point_placemarks(
  cb_folder,
  cb_pts,
  "cb_value"
)

# trailcams ---------------------------------------------------------------

# Define folder structure:

cam_folder <- xml_add_child(root, "Folder")
xml_add_child(cam_folder, "name", "Trail Cameras")

# Point file:

cam_pts <-
  spatial_files %>%
  pluck("trailcam_locations") %>%
  mutate(
    cam_value = str_extract(name, "cam_[0-2]$")
  )

# Add points to the KML and style them:

add_icon_styles(cam_folder, cam_pts$cam_value)
add_point_placemarks(
  cam_folder, 
  cam_pts, 
  "cam_value"
)

# point count locations ---------------------------------------------------

# Define folder structure:

point_count_folder <- xml_add_child(root, "Folder")
xml_add_child(point_count_folder, "name", "Point counts")

# Point file:

point_count_pts <-
  spatial_files %>%
  pluck("point_count_locations") %>%
  mutate(
    pc_value = "pc"
  )

# Add points to the KML and style them:

add_icon_styles(point_count_folder, point_count_pts$pc_value)
add_point_placemarks(
  point_count_folder, 
  point_count_pts,
  "pc_value"
)

# patches -----------------------------------------------------------------

# Define folder structure:

patch_folder <- xml_add_child(root, "Folder")
xml_add_child(patch_folder, "name", "Patches")

# Polygon file:

patches <-
  spatial_files %>%
  pluck("patches")

# Add style to the parent node:

style <- xml_add_child(patch_folder, "Style", id = "patch")

# Define the color and width of lines:

line_style <- xml_add_child(style, "LineStyle")
xml_add_child(line_style, "color", "77ff0000")
xml_add_child(line_style, "width", "1.5")

# Define the color and fill of the patches:

xml_add_child(
  xml_add_child(style, "PolyStyle"),
  "color",
  "77ffffff"
)

patches %>% 
  group_split(name) %>% 
  walk(
    \(.patch) {
      
      # Define XML structure for the patch:
      
      pm <- xml_add_child(patch_folder, "Placemark")
      xml_add_child(
        pm, "name",
        as.character(.patch$name)
      )
      xml_add_child(
        pm,
        "styleUrl",
        "#patch"
      )
      poly_node <- xml_add_child(pm, "Polygon")
      
      # Use tessellate to drape the polygon over the terrain surface rather
      # than float it at a fixed altitude (the default):
      
      xml_add_child(poly_node, "tessellate", "1")
      
      # Define the outer boundary for the shape:
      
      coords <- st_coordinates(.patch)
      outer_boundary <- xml_add_child(poly_node, "outerBoundaryIs")
      xml_add_child(
        xml_add_child(outer_boundary, "LinearRing"),
        "coordinates",
        ring_to_coords(coords[coords[, "L1"] == 1, ])
      )
      walk(
        unique(coords[coords[, "L1"] > 1, "L1"]),
        function(ring_id) {
          inner_boundary <- xml_add_child(poly_node, "innerBoundaryIs")
          xml_add_child(
            xml_add_child(inner_boundary, "LinearRing"),
            "coordinates",
            ring_to_coords(coords[coords[, "L1"] == ring_id, ])
          )
        }
      )
    }
  )

# write and bundle --------------------------------------------------------

# Create a temporary directory for staging the KMZ contents:

kmz_dir <- 
  file.path(
    tempdir(),
    "kmz_build"
  )

# Create the files/ subdirectory. recursive = TRUE ensures the parent
# kmz_build/ directory is also created if it does not already exist.

dir.create(
  file.path(kmz_dir, "files"),
  recursive = TRUE,
  showWarnings = FALSE
)

# Write the KML file that we built above to the staging directory. Note that 
# doc.kml is the required name for Google Earth:

write_xml(
  doc,
  file.path(kmz_dir, "doc.kml")
)

# Define local icon locations:

local_icons <-
  list.files(
    "icons/map_icons",
    full.names = TRUE
  ) %>% 
  set_names_from_path()

# Copy each icon into files using its basename (the name without the path):

local_icons %>%  
  walk(
    ~ file.copy(
      .x,
      file.path(
        kmz_dir,
        "files", 
        basename(.x)
      )
    )
  )

# Zip the staging directory into a KMZ. Note that `withr::with_dir()`
# temporarily changes the working directory to `kmz_dir` for the duration of the
# zip call.

withr::with_dir(
  kmz_dir,
  zip::zip(
    zipfile = here("outputs", "nest_study.kmz"),
    files = 
      c(
        "doc.kml", 
        list.files("files", full.names = TRUE)
      )
  )
)

# end session -------------------------------------------------------------

# Update git:

autopush_updates()

# Clear global environment:

rm(
  list = ls()
)

