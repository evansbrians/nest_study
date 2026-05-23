
# Script to make maps for nest searching

# setup -------------------------------------------------------------------

library(tmap)
library(sf)
library(tidyverse)

tmap_mode("view")

# Read all shapefiles and assign names:

list.files(
  "data/spatial",
  pattern = "geojson$",
  full.names = TRUE
) %>% 
  set_names(
    str_remove_all(., ".*/|\\..*")
  ) %>% 
  map(
    ~ st_read(.x, quiet = TRUE)
  ) %>% 
  list2env(.GlobalEnv)

# function to make maps ---------------------------------------------------

create_map <- 
  function(
    .patch = "forest_geo",
    .zoom = 18.5
  ) {
    
    patch_bbox <- 
      st_bbox(
        patches %>% 
          filter(name == .patch)
      )
    
    m <- 
      tm_basemap(
        "Esri.WorldImagery",
        alpha = 0.4
      ) +
      tm_view(
        set_zoom_limits = c(2, 25),
        set_view = 
          c(
            mean(
              c(patch_bbox$xmin, patch_bbox$xmax)
            ),
            mean(
              c(patch_bbox$ymin, patch_bbox$ymax)
            ),
            .zoom
          ),
        leaflet.options = 
          list(
            zoomSnap = 0.5
          )
      ) +
      tm_shape(
        patches %>% 
          filter(name == .patch),
        bbox = patch_bbox
      ) +
      tm_polygons(
        fill_alpha = 0.2
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
        size = 1.4,
        fill_alpha = 0.6
      ) +
      tm_text(
        text = "name",
        size = 1.4,
        options =
          opt_tm_text(
            just = -0.1
          ),
        xmod = -0.15
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
      )
    
    lf <- 
      tmap_leaflet(m)
    
    lf %>% 
      htmlwidgets::onRender(
        "function(el, x) {
          var tilePane = el.querySelector('.leaflet-tile-pane');
          if (tilePane) {
            tilePane.style.filter = 'grayscale(100%) contrast(1.4)';
            tilePane.style.opacity = '0.5';
          }
        }"
      )
  }

# make and export maps ----------------------------------------------------

# The patches that are larger and don't need as much zoom:

zoom_18 <- 
  patches %>% 
  pull(name) %>% 
  keep(
    ~ str_detect(.x, "grassland_a|grassland_b$|forest_a")
  )

zoom_18 %>% 
  map(
    ~ create_map(
      .patch = .x,
      .zoom = 18
    ) %>% 
      # mapview::mapview()
      mapview::mapshot2(
        file = 
          str_c(
            "patch_maps/",
            .x,
            ".png"
          ),
        # vwidth = 720,
        # vheight = 960,
        vwidth = 960,
        vheight = 720,
        user_agent = "Mozilla/5.0", 
        delay = 20
      )
  )

# Smaller patches that need more zoom:

zoom <- 
  patches %>% 
  pull(name) %>% 
  keep(
    !. %in% zoom_18
  )

zoom %>% 
  map(
    ~ create_map(
      .patch = .x,
      .zoom = 18.5
      ) %>% 
      mapview::mapshot2(
        file = 
          str_c(
            "patch_maps/",
            .x,
            ".png"
          ),
        vwidth = 960,
        vheight = 720,
        user_agent = "Mozilla/5.0", 
        delay = 20
      )
  )
