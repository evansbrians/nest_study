
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

# Get coverboard, trailcam, and point count locations:

list.files(
  "data/spatial",
  pattern = "coverboard|point|trail.*new|nest",
  full.names = TRUE
) %>% 
  set_names(
    str_remove_all(., ".*/|\\..*|_new")
  ) %>% 
  map(
    ~ st_read(.x, quiet = TRUE) %>% 
      st_transform(3857)
  ) %>% 
  list2env(.GlobalEnv)

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
      terra::writeRaster(
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

create_map <- 
  function(.patch = "grassland_b_fence") {
    background_images %>% 
      pluck(.patch) %>% 
      tm_shape() +
      tm_raster(
        col.scale = 
          tm_scale_continuous(values = "gray"),
        col.legend = tm_legend_hide(),
        col_alpha = 0.3
      ) +
      patches %>% 
      tm_shape() +
      tm_polygons(fill_alpha = 0.15) +
      tmap_options(
        frame = FALSE,
        outer.margins = rep(0, 4)
      ) +
      
      # Coverboards:
      
      tm_shape(
        coverboard_locations %>% 
          filter(
            str_detect(
              name, 
              str_c(
                .patch,
                "_cb"
              )
            )
          ) %>% 
          mutate(
            name = 
              str_remove_all(name, "[a-z]*_*")
          )
      ) +
      tm_symbols(
        fill = "orange", 
        col = "black",
        size = 1.2,
        fill_alpha = 0.4
      ) +
      tm_text(
        text = "name",
        size = 1
      ) +
      
      # Point counts:
      
      tm_shape(
        point_count_locations %>% 
          filter(
            str_detect(
              name, 
              str_c(
                .patch,
                "$"
              )
            )
          )
      ) +
      tm_symbols(
        fill = "#bb66dd",
        col = "black",
        size = 1,
        fill_alpha = 0.8
      ) +
      
      # Trailcams:
      
      tm_shape(
        trailcam_locations %>% 
          filter(
            str_detect(
              name, 
              str_c(
                .patch,
                "_trail"
              )
            )
          )
      ) +
      tm_symbols(
        fill = "#93c47d", 
        col = "black",
        size = 1,
        fill_alpha = 0.8
      ) +
      
      # Nests:
      
      tm_shape(nest_locations) +
      tm_symbols(
        fill = "#964B00",
        col = "black",
        size = 0.5,
        fill_alpha = 0.9
      ) #+
      # tm_text(
      #   text = "name",
      #   size = 0.8
      # )
  }

names(background_images) %>% 
  map(
    ~ create_map(.patch = .x) %>% 
      tmap_save(
        filename = 
          str_c(
           "patch_maps/",
           .x,
           ".png"
          )
      )
  )

create_map(.patch = "grassland_b_fence")



