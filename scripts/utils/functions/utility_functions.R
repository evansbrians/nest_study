# Utility functions

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
    system("git pull")
    system("git add .")
    glue("git commit -m '{.commit_message}'") %>% 
      system()
    system("git push")
  }

# Because I don't like writing this all of the time:

n_unique <-
  function(.x) {
    length(
      unique(.x)
    )
  }

# I don't like using `group_by`. This gets around that, the only difference is
# that you have to specify your groups using `vars()` rather than `c()` or a
# single variable name:

summarize_me <- 
  function(.data, ..., .by = NULL) {
    
    # If there's no .by, just use `summarize()`:
    
    if (is.null(.by)) {
      return(
        summarize(.data, ...)
      )
    }
    
    .data %>% 
      group_by(!!!.by) %>% 
      summarize(
        ...,
        .groups = "drop"
      )
  }

## logical validity tests -------------------------------------------------

# These simplify our various logical tests (e.g., within `if ()`).

# Simplify logical validity tests on a value with a function:

is_valid_value <-
  function(.x) {
    !is.null(.x) &&
      length(.x) == 1 &&
      !is.na(.x) &&
      str_trim(.x) != ""
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

# print datasheets --------------------------------------------------------

# Used in dashboard.R

print_datasheets <- 
  function(
    .datasheet = "point_counts",
    .copies = 2
  ) {
    1:.copies %>% 
      walk(
        ~ str_c(
          "lp ",
          here("outputs/print-outs/datasheets/"),
          .datasheet,
          ".pdf"
        ) %>% 
          system()
      )
  }



