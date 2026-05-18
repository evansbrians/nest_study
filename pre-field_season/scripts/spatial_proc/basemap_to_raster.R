
# setup -------------------------------------------------------------------

library(maptiles)
library(tmap)
library(sf)
library(tidyverse)

# Get patches

patches <-
  st_read("data/spatial/patches.geojson", quiet = TRUE) %>% 
  
  # Use 3857 (Web Mercator):
  
  st_transform(3857)

# raster and raster processing --------------------------------------------

# Get the full-color raster from ESRI for each patch

photo_list <-
  patches %>% 
  st_buffer(25) %>% 
  split(.$name) %>% 
  map(
    ~ maptiles::get_tiles(
      x = .x,
      zoom = 19,
      provider = "Esri.WorldImagery",
      crop = TRUE
    ) %>% 
      terra::project("EPSG:4326")
  )

# Make grayscale (multiplies each band with the value and sums bands):

photo_list_grayscale <-
  photo_list %>% 
  map(
    ~ .x %>% 
      sum(
        c(
          0.299,
          0.587,
          0.114
        )
      )
  )

# write to file -----------------------------------------------------------

photo_list_grayscale %>% 
  imap(
    \(.x, .name) {
      writeRaster(
        .x,
        file.path(
          "data/spatial/aerial_images",
          str_c(.name, ".tif")
        ),
        overwrite = TRUE
      )
    }
  )

# how to use --------------------------------------------------------------

tmap_mode("plot")

# Read in the images:

background_images <-
  list.files(
    "data/spatial/aerial_images",
    full.names = TRUE
  ) %>% 
  set_names(
    str_remove(
      basename(.),
      ".tif"
    )
  ) %>% 
  map(
    ~ terra::rast(.x)
  )

# Map'em:

background_images %>% 
  pluck("grassland_b_fence") %>% 
  tm_shape() +
  tm_raster(
    col.scale = 
      tm_scale_continuous(values = "gray"),
    col.legend = tm_legend_hide(),
    col_alpha = 0.5
  ) +
  patches %>% 
  tm_shape() +
  tm_polygons(fill_alpha = 0.2) +
  tmap_options(
    frame = FALSE,
    outer.margins = rep(0, 4)
  )
