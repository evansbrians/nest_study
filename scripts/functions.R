
# universal functions -----------------------------------------------------

# Get names from file paths

set_names_from_path <-
  function(.path) {
    set_names(
      .path,
      basename(.path) %>% 
      str_remove("\\.[^.]+$")
    )
  }

# Autopush for updated files:

autopush_updates <-
  function(.commit_message = "Daily update") {
    system("git add .")
    glue("git commit -m '{.commit_message}'") %>% 
    system()
    system("git push")
  }

# update map print-outs ---------------------------------------------------

# Used in update_map_print-outs.R

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
      )
  }

# function to interactively crop images -----------------------------------

# Used in crop_image.R

crop_image_gadget <- 
  function(.x, .output_path = NULL) {
    
    # Starts depends on whether a file path is provided or an object stored in
    # memory:
    
    # If you supply a path to an image, it reads in the image ...
    
    if (is.character(.x)) {
      img <- image_read(.x)
      
      # ... and assigns an output path:
      
      if (is.null(.output_path)) {
        output_path <- 
          .x %>%
          str_remove("\\.[A-Za-z]+$") %>%
          str_c("_cropped.png")
      }
      
      # If you supply a magick image it just uses that ...
      
    } else if (inherits(.x, "magick-image")) {
      img <- .x
      
      # ... but if you forget to set an output path:
      
      if (is.null(.output_path)) {
        output_path <- "cropped_image.png"
      }
      
      # Stop the process if x is not a file path:
      
    } else {
      stop(".x must be a file path or a magick image object.")
    }
    
    info <- image_info(img)
    
    # Scale down for display if needed (max 800px wide):
    
    display_width <- min(info$width, 800L)
    display_height <- round(info$height * display_width / info$width)
    
    # Write display image to a temp file:
    
    tmp <- tempfile(fileext = ".png")
    
    img %>% 
      image_scale(
        as.character(display_width)
      ) %>% 
      image_write(tmp, format = "png")
    
    # Scale factors: display pixels to original image pixels:
    
    scale_x <- info$width / display_width
    scale_y <- info$height / display_height
    
    # User interface:
    
    ui <- 
      miniPage(
        gadgetTitleBar("Draw a rectangle to crop, then click Done"),
        miniContentPanel(
          imageOutput(
            "img",
            width = str_c(display_width, "px"),
            height = str_c(display_height, "px"),
            
            # The cropping happens with a "brush" (dragged rectangle):
            
            brush = 
              brushOpts(
                id = "brush", 
                resetOnNew = TRUE
              )
          )
        )
      )
    
    # The machinery:
    
    server <- 
      function(input, output, session) {
        
        # Render image based on the display:
        
        output$img <- 
          renderImage(
            {
              list(
                src = tmp, 
                width = display_width, 
                height = display_height, 
                contentType = "image/png"
              )
            }, 
            deleteFile = FALSE
          )
        
        # When you click done:
        
        observeEvent(
          input$done, {
            
            # Grab the brush inputs:
            
            b <- input$brush
            
            # If you didn't draw a rectangle, just stop the app:
            
            if (is.null(b)) {
              stopApp(img)
              
              # If you *did* draw a rectangle, the magic happens:
              
            } else {
              
              # Get the coordinates of the brush rectangle:
              
              x1 <- 
                round(
                  max(0, b$xmin * scale_x)
                )
              x2 <- 
                round(
                  min(info$width, b$xmax * scale_x)
                )
              y1 <- 
                round(
                  max(0, b$ymin * scale_y)
                )
              y2 <- 
                round(
                  min(info$height, b$ymax * scale_y)
                )
              
              # Get the brush area:
              
              brush_width <- x2 - x1
              brush_height <- y2 - y1
              
              # Crop the image (in a language that magick understands):
              
              cropped_image <-
                img %>%
                image_crop(
                  glue("{brush_width}x{brush_height}+{x1}+{y1}")
                ) 
              
              # Write to file:
              
              cropped_image %>% 
                image_write(output_path)
              
              # Close the session:
              
              stopApp(returnValue = cropped_image)
            }
          }
        )
        
        # Cancel button lets you change your mind:
        
        observeEvent(
          input$cancel,
          stopApp(NULL)
        )
        
        # Remove the temporary file on end:
        
        session$onSessionEnded(
          function() {
            try(
              file.remove(tmp), 
              silent = TRUE
            )
          }
        )
      }
    
    # Run the gadget:
    
    runGadget(
      ui, 
      server, 
      viewer = 
        paneViewer(minHeight = display_height + 80)
    )
  }

# functions for updating google earth -------------------------------------

# Used in update_google_earth.R

# Icon styles for points:

add_icon_styles <- 
  function(
    parent, 
    values, 
    scale = "0.8"
  ) {
    values %>%
      unique() %>%
      walk(
        \(val) {
          style <- xml_add_child(parent, "Style", id = val)
          icon_style <- xml_add_child(style, "IconStyle")
          xml_add_child(icon_style, "scale", scale)
          xml_add_child(
            xml_add_child(icon_style, "Icon"),
            "href",
            icon_urls[[val]]
          )
          xml_add_child(
            xml_add_child(style, "LabelStyle"),
            "scale",
            "0"
          )
        }
      )
  }

# Add placemarks to points:

add_point_placemarks <- 
  function(
    parent, 
    pts, 
    value_col
  ) {
    pts %>%
      bind_cols(
        st_coordinates(.)
      ) %>% 
      st_drop_geometry() %>%
      rename(
        lon = X,
        lat = Y,
        val_col = {{ value_col }}
      ) %>%
      pwalk(
        \(
          name, 
          val_col, 
          lon, 
          lat, 
          ...
        ) {
          pm <- xml_add_child(parent, "Placemark")
          xml_add_child(
            pm,
            "name", 
            name
          )
          xml_add_child(
            pm,
            "styleUrl", 
            str_c("#", val_col)
          )
          xml_add_child(
            xml_add_child(pm, "Point"),
            "coordinates",
            str_c(lon, lat, 0, sep = ",")
          )
        }
      )
  }

# The ugly way to provide coordinates for the patch polygons (it's going to get
# uglier!):

ring_to_coords <- 
  function(xy) {
    str_c(
      xy[, "X"], 
      xy[, "Y"], 
      0, 
      sep = ","
    ) %>%
      str_c(collapse = " ")
  }
