# Time and date functions

# pretty dates (as factor) ------------------------------------------------

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

# character time to time --------------------------------------------------

char_time_to_time <-
  function(.time) {
    hm(.time) %>% 
      period_to_seconds() %>% 
      hms::as_hms()
  }

# character or POSIXt to character time -----------------------------------

make_pretty_time <-
  function(
    .time = now(),
    .offset = minutes(0),
    .leading_zero = TRUE
  ) {
    
    # Character time:
    
    if (is.character(.time)) {
      .time <- 
        str_extract(.time, "[0-9]{1,2}:[0-9]{1,2}") %>% 
        str_pad(
          width = 5, 
          side = "left",
          pad = 0
        )
    } 
    
    # Datetime:
    
    if (is.POSIXt(.time)) {
      .time <- 
        format(.time, "%H:%M")
    }
    
    # Make time:
    
    .time %>% 
      { hm(.) + .offset } %>%
      hms::hms() %>% 
      as.character() %>% 
      str_sub(1, 5) %>% 
      
      # Optionally remove the leading zero:
      
      {
        if(!.leading_zero) {
          str_remove(., "^0")
        } else .
      }
  }

# get sampling week -------------------------------------------------------

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

# weather push-back -------------------------------------------------------

# Record a weather cancellation: from .from_date, everything through that
# week's Sunday slides forward .days day(s). Stackable (two rained-out days in a
# week = two rows). Appends to data/schedule_pushes.rds.

push_schedule <-
  function(
    .from_date, 
    .days = 1,
    .outpath = "data/schedule_pushes.rds"
  ) {
    
    # Define the read and write path:
    
    path <- here::here(.outpath)
    
    # Get existing schedule data:
    
    existing <-
      if (file.exists(path)) {
        read_rds(path)
      } else {
        NULL
      }

    # Skip a repeat run for the same day:

    if (
      !is.null(existing) &&
      as_date(.from_date) %in% existing$from_date
    ) {
      message(
        "Schedule push already recorded for ",
        as_date(.from_date),
        "; no change."
      )
      return(invisible(existing))
    }

    # Define the new row(s) to add to the existing data:
    
    new_row <-
      tibble(
        from_date = as_date(.from_date),
        days = as.integer(.days)
      )
    
    # Define output:
    
    out <-
      if (is.null(existing)) {
        new_row
      } else {
        bind_rows(existing, new_row)
      }
    
    # Write to file:
    
    write_rds(out, path)
    
    # Send a message:
    
    message(
      "Recorded schedule push: from ", 
      as_date(.from_date),
      " by ", .days,
      " day(s)."
    )
    invisible(out)
  }

# Apply recorded pushes to the schedule table:

apply_schedule_push <-
  function(
    .data, 
    .date_col = "date",
    .outpath = "data/schedule_pushes.rds"
  ) {
    if (
      !.date_col %in% names(.data) || 
      nrow(.data) == 0
    ) return(.data)
    
    pushes <-
      tryCatch(
        read_rds(
          here::here("data/schedule_pushes.rds")
        ),
        error = function(e) NULL
      )
    
    if (
      is.null(pushes) || 
      nrow(pushes) == 0
    ) return(.data)
    
    pushes <-
      pushes %>%
      mutate(
        from_date = as_date(from_date),
        days = as.integer(days),
        week_end = from_date + (7 - wday(from_date, week_start = 1))
      )

    # Non-equi join each date to the push window that covers it (windows are
    # disjoint across weeks, so at most one matches), then add that shift.

    .data %>%
      mutate(.push_date = as_date(.data[[.date_col]])) %>%
      left_join(
        pushes,
        join_by(between(.push_date, from_date, week_end))
      ) %>%
      mutate("{.date_col}" := .push_date + coalesce(days, 0L)) %>%
      select(!c(.push_date, from_date, days, week_end))
  }

# easy-to-read date ranges ------------------------------------------------

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