# Spatial functions

# basic spatial utility functions -----------------------------------------

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
