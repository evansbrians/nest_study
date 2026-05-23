
# Script for generating a stratified random coverboard order for each day and
# week, where the following constraints are met:

# 1) All coverboard are sampled once per week
# 2) No coverboard is sampled more than once per week
# 3) Spatially adjacent coverboards are not sampled on the same day
# 4) The last coverboards sampled on a given week are not sampled on the first
#    sampling event of the following week.

# setup -------------------------------------------------------------------

library(sf)
library(tidyverse)

# Read in shapefiles and convert each to a list (one list item per patch):

patches <-
  st_read("data/spatial/patches.geojson", quiet = TRUE) %>% 
  st_transform(32618) %>% 
  split(.$name)

coverboards <-
  st_read("data/spatial/coverboard_locations.geojson", quiet = TRUE) %>% 
  st_transform(32618) %>% 
  mutate(
    patch = str_remove(name, "_cb.*"),
    board_name = name,
    .before = 1,
    .keep = "unused"
  ) %>% 
  split(.$patch)

# Get starts:

coverboard_url <-
  file.path(
    "https://docs.google.com/spreadsheets/d",
    "1XkozYdl1UfBVF9lMcP9ZjmTHflzF3q7l-NU6t2U11o4"
  )

board_starts <-
  googlesheets4::sheet_names(coverboard_url) %>% 
  set_names() %>% 
  map(
    ~ googlesheets4::read_sheet(coverboard_url, sheet = .x) %>% 
      mutate(
        board_id = 
          str_c(
            patch_id,
            "_cb_",
            board_num
          ),
        date = as_date(date),
        .keep = "none"
      )
  )

# generate the sampling pool between boards -------------------------------

# Make a 3-column data frame where the first column is the origin, the second
# column is destination, and the third column is the distance between boards:

board_distances <-
  coverboards %>% 
  map(
    \(.coverboards) {
      st_distance(.coverboards) %>%
        as_tibble(
          .name_repair = ~ .coverboards$board_name
        ) %>% 
        mutate(
          board_1 = as.character(.coverboards$board_name),
          across(
            !board_1,
            ~ as.numeric(.x)
          )
        ) %>% 
        pivot_longer(
          cols = !board_1, 
          names_to = "board_2", 
          values_to = "distance"
        ) %>% 
        filter(board_1 != board_2) %>% 
        arrange(board_1, board_2)
    }
  )

# Generate a reduced pool to sample from, omitting the closest boards:

board_pools <-
  board_distances %>% 
  map(
    \(.board_distances) {
      .board_distances %>% 
        filter(
          distance > min(distance) + 10,
          .by = board_1
        ) %>% 
        select(!distance)
    }
  )

# function to get the coverboard order for a single week ------------------

get_coverboard_order <-
  function(
    .board_pool,
    .n_draws = 3,
    .prev_boards = NULL
  ) {
    
    # `repeat` is a control flow construct that repeats a process until the
    # desired output has been generated (to account for potential problems along
    # the way).
    
    repeat {
      result <-
        
        # `tryCatch()` will ensure that an error doesn't end the process:
        
        tryCatch(
          
          # `reduce()` is a *purrr* function that iteratively applies a function
          # across a sequence, carrying an accumulator (`.x`) forward at each
          # step. Here, `.y` is a loop counter defined by `seq_len(.n_draws)` --
          # its value is unused, and `seq_len()` is only here to control how
          # many iterations run.
          
          reduce(
            seq_len(.n_draws),
            ~ {
              
              # Constraint: Exclude boards checked on the previous sampling day
              # for the first draw only. Filter available from .x$cands (not
              # from `available` itself) in the cands update so that boards
              # excluded here remain eligible for draws 2 and 3:
              
              available <-
                if (.x$first_draw && !is.null(.prev_boards)) {
                  filter(
                    .x$cands,
                    !board_1 %in% .prev_boards,
                    !board_2 %in% .prev_boards
                  )
                } else {
                  .x$cands
                }
              
              draw <- slice_sample(available, n = 1)
              
              if (nrow(draw) == 0) stop("dead end")
              
              list(
                first_draw = FALSE,
                draws = bind_rows(.x$draws, draw),
                
                # Constraint: Remove used boards from future draws this week:
                
                cands =
                  filter(
                    .x$cands,
                    !board_1 %in% c(draw$board_1, draw$board_2),
                    !board_2 %in% c(draw$board_1, draw$board_2)
                  )
              )
            },
            
            # .init is the starting point of the reduction -- it starts with a
            # switch that identifies when it is a first or subsequent draw, the
            # original candidates frame, and 0-row tibble of `draws` that will
            # be populated in each iteration:
            
            .init =
              list(
                first_draw = TRUE,
                draws = tibble(),
                cands = .board_pool
              )
          ) %>%
            
            # `reduce()` returns the final state of the accumulator. Here, we
            # only want the draws themselves:
            
            pluck("draws"),
          
          # Return NULL if there is an error:
          
          error = function(e) NULL
        )
      
      # This bit is necessary because some boundary conditions will generate a
      # two-row data frame. If that happens, the process tries again -- if not,
      # it returns the result:
      
      if(
        !is.null(result) && 
        nrow(result) == .n_draws
      ) return(result)
    }
  }

# function to generate a full season schedule for a single patch ----------

get_coverboard_season <-
  function(
    .board_pool,
    .board_starts,
    .n_draws = 3,
    .n_weeks = 11
  ) {
    
    # Constraint: Boards from the most recent sampling date are not the sampled
    # on the first day of the following week. Currently sampled board seed this
    # constraint:
    
    previous_boards_init <-
      if(!is.null(.board_starts)) {
        .board_starts %>% 
          filter(
            date == max(date)
          ) %>% 
          pull(board_id)
      } else {
        NA
      }
    
    # `crossing()` generates all pairwise combinations of weeks and days:
    
    crossing(week = 1:.n_weeks, day = 1:.n_draws) %>%
      
      # Split each week into its own list:
      
      group_split(week) %>%
      
      # `reduce()` here works on the week accumulator and the loop counter:
      
      reduce(
        ~ {
          
          # Get the coverboard order for a week:
          
          week_order <- 
            get_coverboard_order(
              .board_pool = .board_pool,
              .n_draws = .n_draws,
              .prev_boards = .x$prev_boards
            )
          
          list(
            
            # Pass the results to the accumulator:
            
            result =
              bind_rows(
                .x$result,
                bind_cols(.y, week_order)
              ),
            
            # Send the last draw to the accumulator so the last 2 boards checked
            # are not among the first two boards of the next week:
            
            prev_boards = 
              week_order %>% 
              slice_tail() %>% 
              as.character()
          )
        },
        
        # Initial values are a 0-row tibble that will be filled with results in
        # each iteration and the starting previous board values (from last
        # week):
        
        .init =
          list(
            result = tibble(),
            prev_boards = previous_boards_init
          )
      ) %>%
      pluck("result")
  }

# run across all patches --------------------------------------------------

season_schedules <-
  map2(
    board_pools,
    board_starts,
    ~ get_coverboard_season(
      .board_pool = .x,
      .board_starts = .y,
      .n_draws = 3,
      .n_weeks = 11
    ) %>% 
      select(
        !week:day
      )
  )
