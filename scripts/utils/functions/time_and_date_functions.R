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