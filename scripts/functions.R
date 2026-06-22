
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

# Summary statistics for any dataset, variable, and grouping variable:

get_summary_stats <-
  function(
    .data,
    .var,
    ...
  ) {
    .data %>% 
      summarize(
        n = n(),
        min = min({{ .var }}, na.rm = TRUE),
        max = max({{ .var }}, na.rm = TRUE),
        range = max - min,
        mean = mean({{ .var }}, na.rm = TRUE),
        median = median({{ .var }}, na.rm = TRUE),
        sd = sd({{ .var }}, na.rm = TRUE),
        se = sd/sqrt(n),
        ...
      )
  }

# Because I am often annoyed with the fact that filter doesn't allow you to 
# drop columns:

filter_me <- 
  function(.data, ...) {
    
    filter_exprs <- rlang::enquos(...)
    
    cols_to_drop <- 
      filter_exprs %>% 
      purrr::map(rlang::quo_get_expr) %>% 
      purrr::map(all.vars) %>% 
      unlist() %>% 
      unique()
    
    .data %>% 
      dplyr::filter(...) %>% 
      dplyr::select(!dplyr::any_of(cols_to_drop))
  }

## time and dates ---------------------------------------------------------

# Pretty date (as factor):

make_pretty_dates <-
  function(
    .date,
    .abbr = TRUE,
    .out_factor = TRUE
  ) {
    
    # Format dates based on abbreviated or spelled-out month
    
    date_labels <-
      format(
        as_date(.date),
        if (.abbr) "%d %b" else "%d %B"
      )
    
    # Return factor or character:
    
    if(.out_factor) {
      factor(
        .date, 
        levels = unique(.date),
        labels = unique(date_labels)
      )
    } else {
      date_labels
    }
  }

# Character time to time:

char_time_to_time <-
  function(.time) {
    hm(.time) %>% 
      period_to_seconds() %>% 
      hms::as_hms()
  }

# Get sampling week:

get_sampling_week <-
  function(
    .date = today(),
    .week_offset = 19,
    .day_offset = 4
  ) {
    week(
      .date + .day_offset
    ) - .week_offset
  }

## spatial functions ------------------------------------------------------

# Because I get annoyed with constantly having to convert the output of
# `st_distance()` to numeric and setting `by_element = TRUE`:

st_distance_m <-
  function(
    .x, 
    .y,
    .by_element = TRUE
  ) {
    st_distance(
      .x,
      .y,
      by_element = .by_element
    ) %>% 
      units::set_units("m") %>% 
      units::drop_units()
  }

# Convert a data frame with a longitude and latitude column to points, if
# possible.

convert_df_to_pts <-
  function(
    .data,
    .lon = "lon",
    .lat = "lat",
    .crs = 4326,
    .crs_out = .crs
  ) {
    
    # Rename longitude and latitude columns:
    
    data_lonlat <-
      .data %>% 
      rename(
        longitude = matches({{ .lon }}),
        latitude = matches({{ .lat }})
      )
    
    # Stop and send an error message if the longitude and latitude columns could
    # not be determined:
    
    if (
      !all(
        c("longitude", "latitude") %in% colnames(data_lonlat)
      )
    ) {
      cli::cli_abort(
        "Could not detect coordinate columns.
        Please supply {.arg .lon} and {.arg .lat} explicitly.")
    } 
    
    # Convert to sf:
    
    data_lonlat %>% 
      st_as_sf(
        coords = c("longitude", "latitude"),
        crs = .crs
      ) %>% 
      
      # Transform the CRS if necessary:
      
      {
        if(.crs != .crs_out) {
          st_transform(., .crs_out)
        } else {
          .
        }
      }
  }

# Convert lines to points:

convert_line_to_points <-
  function(.linestring, .density = NULL) {
    
    # Don't do anything if it's already points (just return the points):
    
    if (
      all(
        st_geometry_type(.linestring) == "POINT")
    ) {
      return(.linestring)
    }
    
    # If it *is* a linestring and `.density` is numeric, additional points will
    # be added to the line (with distance between vertices defined by .density
    # in meters:
    
    if (is.numeric(.density)) {
      st_segmentize(.linestring, dfMaxLength = .density) %>%
        st_cast("POINT", warn = FALSE) %>%
        st_sf()
    } else {
      
      # If `.density` is NULL, the original vertices are converted to points:
      
      st_cast(
        .linestring,
        "POINT",
        warn = FALSE
      )
    }
  }

# Convert points to lines:

convert_points_to_lines <-
  function(.points, .by = NULL) {
    
    # Don't do anything if it's already a line (just return the points):
    
    if (
      all(
        st_geometry_type(.points) %in% c("LINESTRING", "MULTILINESTRING")
      )
    ) {
      return(.points)
    }
    
    # If there is no column to group by, just make a single linestring of the
    # whole thing:
    
    if (missing(.by)) {
      .points %>% 
        st_combine() %>% 
        st_cast("LINESTRING") %>% 
        st_as_sf() %>% 
        rename()
    } else {
      
      # If there *is* a column to group by, define a separate line for each
      # group:
      
      .points %>% 
        group_by({{ .by }}) %>% 
        summarize(
          do_union = FALSE,
          .groups = "drop"
        ) %>% 
        st_cast("LINESTRING") %>% 
        st_as_sf()
    }
  }

# Function that returns the nearest geometry between two sf objects, returning
# the geometry of the reference object as an sf file:

get_nearest_geometry <-
  function(
    .target,
    .reference,
    .max_distance = Inf
  ) {
    slice(
      .reference,
      st_nearest_feature(
        .target,
        .reference
      )
    )
  }

## visualization ----------------------------------------------------------

# Plot theme:

my_plot_theme <-
  function() {
    theme_bw(base_size = 14) +
      theme(
        text = element_text(family = "Times"),
        plot.title =
          element_text(face = "bold"),
        plot.subtitle =
          element_text(color = "grey40"),
        strip.text =
          element_text(face = "bold"),
        plot.margin = 
          margin(10, 14, 10, 10, "pt")
      )
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
      ) +
      
      # Trails:
      
      tm_shape(tracks) +
      tm_lines(
        col = "#8f7f0f",
        col_alpha = 0.5,
        lty = "dashed",
        lwd = 2
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

# scheduling output functions ---------------------------------------------

# Used in schedule_pdf.R and the schedule app (pages/schedule/index.qmd).

# Dates ranges that are easy to read:

pretty_date_range <-
  function(.schedule) {
    first_day <- min(.schedule$date)
    last_day <- max(.schedule$date)
    
    if (month(first_day) == month(last_day)) {
      str_c(
        mday(first_day),
        "-",
        mday(last_day),
        " ",
        month(
          first_day,
          label = TRUE,
          abbr = FALSE
        )
      )
    } else {
      str_c(
        format(first_day, "%d %B"),
        " - ",
        format(last_day, "%d %B")
      )
    }
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

# Functions for path processing -------------------------------------------

## average path (point-averaging) -----------------------------------------

# Calculate the average vertices between two paths:

average_paths <-
  function(
    .target_path,
    .modifier_path,
    .distance_threshold = 5
  ) {
    .target_path %>%
      convert_line_to_points() %>%
      mutate(
        
        # Get the nearest vertex in the modifier path fir each vertex in the
        # target path:
        
        nearest_geom =
          get_nearest_geometry(
            .,
            convert_line_to_points(
              filter(.modifier_path)
            )
          ) %>%
          st_geometry(),
        
        # Calculate the distance between the target and modifier vertices:
        
        dist = st_distance_m(geometry, nearest_geom),
        
        # If the distance (`..3`) between the target (`..1`) and modifier
        # (`.002`) vertex is greater than some threshold, just return the target
        # vertex, otherwise, average their locations:
        
        geometry =
          list(
            geometry,
            nearest_geom,
            dist
          ) %>%
          pmap(
            ~ if (..3 > .distance_threshold) {
              ..1
            } else {
              (..1 + ..2) / 2
            }
          ) %>%
          st_sfc(
            crs = st_crs(.target_path)
          )
      ) %>%
      select(name)
  }

## detect a turnaround ----------------------------------------------------

# If you turn around while continuing to collect path data, this function will
# detect that and split the data (it also accounts for GPS noise that might
# generate false turnaround points):

split_paths_at_turnaround <-
  function(
    .paths,
    .density = 1
  ) {
    
    # Detect a turnaround as a point in which the distance from the
    # previous point is less than the distance between the previous point
    # and the next point:
    
    .paths %>%
      convert_line_to_points(.density = .density) %>%
      split(.$name) %>%
      map(
        ~ .x %>%
          mutate(
            
            # Distance between the current and previous point:
            
            dist_to_previous =
              st_distance_m(
                geometry,
                lag(geometry)
              ),
            
            # Distance between the previous point and the next point:
            
            dist_lag_lead =
              st_distance_m(
                lag(geometry),
                lead(geometry)
              ),
            across(
              dist_to_previous:dist_lag_lead,
              ~ replace_na(.x, 0)
            ),
            
            # Turnaround detection:
            
            turnaround = dist_lag_lead < dist_to_previous,
            
            # Assign individual paths based on the turnaround:
            
            path_id = cumsum(turnaround) + 1
          ) %>%
          
          # Subset columns:
          
          select(name, path_id)
      ) %>%
      bind_rows()
  }

## average self overlapping paths -----------------------------------------

# If a turnaround is detected on a smoothed path (smoothing first is
# important!), this will split the path into segments and calculate the average
# path location using the forward moving path as the baseline:

average_self_overlapping_paths <-
  function(
    .paths,
    .distance_threshold = 5,
    .density = 1
  ) {
    if (st_is_longlat(.paths)) {
      cli::cli_abort(
        "Unprojected data detected: please transform your data to a projected 
        CRS with {.fn st_transform}"
      )
    }
    
    # Segmented path based on turnarounds:
    
    segmented_paths <-
      split_paths_at_turnaround(.paths) %>%
      mutate(
        direction =
          if_else(
            path_id %% 2 == 1,
            "forward",
            "backward"
          ),
        .after = path_id
      )
    
    # Process each path and average if a turnaround exists:
    
    segmented_paths %>%
      pull(name) %>%
      unique() %>%
      map(
        \(.path_name) {
          path_segments <-
            segmented_paths %>%
            filter(name == .path_name)
          
          # Stop if only one segment is detected:
          
          if (n_distinct(path_segments$path_id) == 1) {
            cli::cli_inform(
              "Only a single path was detected for {(.path_name)}"
            )
            return(
              path_segments %>%
                convert_points_to_lines(.by = name)
            )
          } else {
            cli::cli_inform(
              "{n_distinct(path_segments$path_id)} segments averaged
              for {(.path_name)}!"
            )
          }
          
          # Forward and backward segments:
          
          forward <- filter(path_segments, direction == "forward")
          
          # Using the forward line as a reference, calculate the average between
          # the forward path and backward paths:
          
          path_segments %>%
            filter(direction == "backward") %>%
            split(.$path_id) %>%
            reduce(
              ~ average_paths(
                .target_path = .x,
                .modifier_path = .y,
                .distance_threshold = .distance_threshold
              ),
              .init =
                path_segments %>%
                filter(direction == "forward")
            )
        }
      ) %>% 
      bind_rows() %>% 
      convert_points_to_lines(.by = name)
  }

## average two different paths --------------------------------------------

average_different_paths <-
  function(
    .paths,
    .target_name,
    .modifier_name,
    .distance_threshold = 5
  ) {
    if (st_is_longlat(.paths)) {
      cli::cli_abort(
        "Unprojected data detected: please transform your data to a projected
        CRS with {.fn st_transform}"
      )
    }
    .paths %>%
      filter(name != .target_name) %>%
      bind_rows(
        average_paths(
          .target_path =
            .paths %>%
            filter(name == .target_name) %>%
            convert_line_to_points(),
          .modifier_path =
            .paths %>%
            filter(name == .modifier_name) %>%
            convert_line_to_points(),
          .distance_threshold = 5
        ) %>%
          convert_points_to_lines(.by = name)
      ) %>%
      arrange(name)
  }

## paths to branches ------------------------------------------------------

# Make separate paths from potential branches:

get_branches <-
  function(
    .target_line,
    .reference_line,
    .branch_distance = 2,
    .n_vertices = 10
  ) {
    
    target_line_pts <- convert_line_to_points(.target_line)
    reference_line_pts <- convert_line_to_points(.reference_line)
    
    branched_path <-
      target_line_pts %>%
      mutate(
        
        # Get the nearest point from the reference path and its distance:
        
        nearest_geom = 
          get_nearest_geometry(., reference_line_pts) %>% 
          st_geometry(),
        dist = st_distance_m(geometry, nearest_geom),
        
        # Define a point as a potential branch if it is .branch_distance meters
        # from the reference path:
        
        branch_pt = dist > .branch_distance,
        
        # Define groups based on state change
        
        new_branch = 
          if_else(
            branch_pt &
              !lag(
                branch_pt, 
                default = first(branch_pt)
              ),
            1,
            0
          ),
        
        # Add potential branch ids based on consecutive branch points:
        
        branch_id = 
          str_c(
            "branch_", 
            cumsum(new_branch) + 1
          )
      ) %>% 
      
      # Subset to branches:
      
      filter(branch_pt) %>% 
      
      # To be defined as a branch, there must be at least .n_vertices
      # consecutive branch vertices (doesn't apply here, but it could in the
      # future):
      
      filter(
        n() > .n_vertices,
        .by = branch_id
      ) %>% 
      
      # Remove unnecessary columns:
      
      select(branch_id)
    
    if (nrow(branched_path) == 0){
      cli::cli_inform("No branches found!")
    } else {
      
      cli::cli_inform(
        "Path divided into {length(unique(branched_path$branch_id))} branches!"
      )
      
      # Split into a list of branches:
      
      branched_path %>% 
        rename(name = branch_id) %>% 
        split(.$name) %>% 
        
        # And make into a line:
        
        map(
          ~ .x %>% 
            summarize(
              do_union = FALSE,
              .by = name
            ) %>% 
            st_cast("LINESTRING") %>% 
            st_as_sf()
        )
    }
  } 

## snap path vertices -----------------------------------------------------

# Snap the beginning and end of a path to another path:

snap_paths <-
  function(
    .target_line,
    .reference_line,
    .tolerance = 5,
    .first = FALSE,
    .last = FALSE
  ) {
    
    # Convert the target and reference lines to points, if necessary:
    
    target_line <- convert_line_to_points(.target_line)
    reference_line <- convert_line_to_points(.reference_line)
    
    # Define the start and end points of the lines:
    
    line_start <- slice_head(target_line)
    line_end <- slice_tail(target_line)
    
    # Connect the starting point if the start is the connection:
    
    if(.first) {
      nearest_geom <- get_nearest_geometry(line_start, reference_line)
      if (
        st_distance_m(line_start, nearest_geom) > .tolerance
      ) {
        cli::cli_inform(
          "No points in {.arg .reference_line} were within 
          {.arg .tolerance = {(.tolerance)}} meters of the first point in the
          line, you may want to increase {.arg .tolerance}")
      } else {
        target_line <- 
          bind_rows(nearest_geom, target_line)
      }
    }
    
    # Connect the ending point if the end is the connection:
    
    if(.last) {
      nearest_geom <- get_nearest_geometry(line_end, reference_line)
      if (
        st_distance_m(line_end, nearest_geom) > .tolerance
      ) {
        cli::cli_inform(
          "No points in {.arg .reference_line} were within 
          {.arg .tolerance = {(.tolerance)}} meters of the last point in the
          line, you may want to adjust {.arg .tolerance}")
      } else {
        target_line <- bind_rows(target_line, nearest_geom)
      }
    }
    
    # Make into a LINESTRING:
    
    target_line %>% 
      mutate(name = line_start$name) %>% 
      convert_points_to_lines(.by = name)
  }

