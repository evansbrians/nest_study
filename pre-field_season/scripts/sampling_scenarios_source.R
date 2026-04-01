
# sun times ---------------------------------------------------------------

# Helper function for generating an empty tibble:

empty_duration_tbl <- 
  function() {
    tibble(
      activity = character(),
      duration = numeric()
    )
  }

# Convenience wrapper for converting sun times for a given date or set of dates:

our_time <-
  function(.date, .sun) {
    getSunlightTimes(
      date = as_date(.date),
      lat = 38.89,
      lon = -78.16,
      keep = .sun,
      tz = "America/New_York"
    ) %>% 
      pull(.sun)
  }

# predator counts (point counts and cover boards) -------------------------

# Calculate the time taken for predator counts:

# Total time is estimated at 200 minutes. This is based on:
# - 4 patches checked
# - 60 minutes total: 20-minute walk between 3 patches
# - 40 minutes total: 10 minutes for each point count, including transit
# - 100 minutes across patches: 5 minutes for each coverboard check and 5
#   minutes transit towards, between, and after boards, totaling 25
#   minutes for each patch.

get_predator_time <- 
  function(
    .n_predator_patches = 4,  # How many patches are you monitoring?
    .patch_transit      = 20, # Transit time between patches in minutes
    .board_time         = 5,  # Time taken to check a cover board
    .point_count_time   = 10, # Time taken to conduct a point count
    .board_transit      = 5,  # Transit time between cover boards
    .n_boards_checked   = 2   # Number of cover boards checked per patch
  ) {
    
    if(.n_predator_patches == 0) {
      return(
        empty_duration_tbl()
      )
    }
    
    tibble(
      activity = 
        str_c(
          "predator_counts_",
          seq(.n_predator_patches)
        ) 
    ) %>% 
      
      # Add durations:
      
      mutate(
        duration = 
          .point_count_time +
          .n_boards_checked * (.board_time + .board_transit) +
          
          # Add patch transit to all but the last count:
          
          if_else(
            row_number() != n(),
            .patch_transit,
            0
          )
      )
  }

# nest check times --------------------------------------------------------

# Calculate the time taken to check nests:

get_nest_check_time <-
  function(
    .n_active_nests   = 16, # How many active nests are there?
    .n_active_patches = 4,  # How many patches are the active nests in?
    .patch_transit    = 20, # Transit time between patches in minutes
    .check_time       = 5,  # Minutes per check & concealment photo
    .nest_transit     = 5   # How long does it take to move between nests?
  ) {
    
    # If there are no active nests, there is no transit time to or from nests:
    
    if(.n_active_nests == 0) {
      return(
        empty_duration_tbl()
      )
    }
    
    # Ensure that the number of patches doesn't have to be added if there is 
    # less than 2 active nests per patch:
    
    n_patches <- min(.n_active_patches, .n_active_nests)
    
    tibble(
      activity = 
        str_c(
          "nest_check_",
          seq_len(n_patches)
        ),
      nests = floor(.n_active_nests / n_patches)
    ) %>% 
      
      # Add remainder of the division to the first patch
      
      mutate(
        nests = 
          if_else(
            row_number() == 1,
            nests + .n_active_nests %% n_patches,
            nests
          ),
        
        # Add times:
        
        duration =
          
          # Time to check time and transit between nests:
          
          nests * (.check_time + .nest_transit) +
          
          # Add between-patch transit time to all but the first patch:
          
          if_else(
            row_number() == 1,
            0,
            .patch_transit
          )
      ) %>% 
      select(!nests)
  }

# nest search time --------------------------------------------------------

# Calculate the nest search time:

get_nest_search_times <- 
  function(
    .n_search_patches = 2,  # How many patches will you search?
    .search_time      = 60, # How long will you spend searching each patch?
    .patch_transit    = 20  # How long does it take to travel between patches?
  ) {
    
    if(.n_search_patches == 0) {
      return(
        empty_duration_tbl()
      )
    }
    
    tibble(
      activity = 
        str_c(
          "nest_search_",
          seq_len(.n_search_patches)
        )
    ) %>%
      
      # Add patch transit:
      
      mutate(
        duration = .search_time + .patch_transit
      )
  }

# durations ---------------------------------------------------------------

# Wrapper function for each activity that also adds break times:

get_daily_durations <-
  function(
    .n_active_nests     = 16,   # How many nests will you check?
    .n_active_patches   = 4,    # How many patches are the nests in?
    .n_search_patches   = 2,    # How many patches would you like to search?
    .search_time        = 60,   # How many patches would you like to search?
    .n_predator_patches = 4,    # How many patches are you monitoring?
    .patch_transit      = 20,   # Transit time between patches in minutes
    .board_time         = 5,    # Time taken to check a cover board
    .n_boards_checked   = 2,    # Number of cover boards checked per patch
    .point_count_time   = 10,   # Time taken to conduct a point count
    .board_transit      = 5,    # Transit time between cover boards
    .check_time         = 5,    # Minutes per check & concealment photo
    .nest_transit       = 5     # How long does it take to move between nests?
  ) {
    
    # Run field activities functions and combine into a single data frame:
    
    durations <- 
      bind_rows(
        
        # Predator counts:
        
        get_predator_time(
          .n_predator_patches = .n_predator_patches,
          .patch_transit = .patch_transit,
          .board_time = .board_time,
          .n_boards_checked = .n_boards_checked,
          .point_count_time = .point_count_time,
          .board_transit = .board_transit
        ),
        
        # Nest checks:
        
        get_nest_check_time(
          .n_active_nests = .n_active_nests,
          .n_active_patches = .n_active_patches,
          .patch_transit = .patch_transit,
          .check_time = .check_time,
          .nest_transit = .nest_transit
        ),
        
        # Nest searches:
        
        get_nest_search_times(
          .n_search_patches = .n_search_patches,
          .search_time = .search_time,
          .patch_transit = .patch_transit
        )
      ) %>%
      
      # Calculate the cumulative duration:
      
      mutate(
        cum_duration = cumsum(duration)
      )
    
    # Return a zero-row data frame if there are no duration rows:
    
    if (nrow(durations) == 0) {
      return(durations)
    }
    
    # Define break times (when 2-hour thresholds in active times are crossed):
    
    seq(
      120, 
      max(durations$cum_duration), 
      by = 120
    ) %>% 
      
      # Determine where to put breaks (row indices):
      
      findInterval(durations$cum_duration) %>% 
      
      # If multiple thresholds are crossed in a given interval, `unique()`
      # prevents inserting duplicate breaks after that row:
      
      unique() %>% 
      
      # Remove the break interval if it would be the last activity of the day:
      
      keep(
        ~ (.x + 1) < nrow(durations)
      ) %>% 
      
      # Insert from the end of the day backward so earlier row additions do not
      # shift the indices of later break positions:
      
      rev() %>% 
      
      # Iteratively add one break row at a time, working backward through the
      # indices:
      
      reduce(
        .init = durations,
        .f = function(df, i) {
          add_row(
            df,
            activity = "break",
            duration = 20,
            .after = i + 1
          )
        }
      ) %>% 
      
      # Recalculate the durations:
      
      mutate(
        cum_duration = cumsum(duration)
      )
  }

# daily schedule ----------------------------------------------------------

# Wrapper function for generating a daily schedule:

get_daily_schedule <-
  function(.date, ...) {
    
    activity_times <-
      tibble(
        activity = "arrive",
        start_time = our_time(.date, "dawn"),
        end_time = our_time(.date, "sunrise")
      )
    
    # Get input parameters:
    
    params <- rlang::list2(...)
    
    activity_times %>% 
      
      # Process data and add duration in minutes for each activity:
      
      bind_rows(
        rlang::exec(get_daily_durations, !!!params)
      ) %>% 
      
      # Add times:
      
      mutate(
        cum_duration = replace_na(cum_duration, 0),
        end_time = activity_times$end_time + minutes(cum_duration),
        start_time = 
          lag(end_time, default = activity_times$start_time)
      ) %>% 
      
      bind_rows(
        tibble(
          activity = "done",
          start_time = last(.$end_time)
        )
      ) %>% 
      
      # Formatted output:
      
      mutate(
        activity, 
        time = 
          start_time %>% 
          hms::as_hms() %>% 
          str_remove(":[0-9]{2}$"),
        .keep = "none"
      )
  }
