# Script for generating a random coverboard order for each week, where no
# coverboard is sample more than once per week and adjacent coverboards are
# not sampled.

# setup -------------------------------------------------------------------

library(tidyverse)

# function to calculate the coverboard order for a given week -------------

get_coverboard_order <-
  function(
    .pool = 1:6, 
    .n_draws = 3
  ) {
    
    # Make a data frame of all potential coverboards to check on a sampling day:
    
    candidates <-
      
      # `crossing()` generates all pairwise combinations of .pool with itself:
      
      crossing(x = .pool, y = .pool) %>%
      
      # Subset to where x is the low number and there is at least one coverboard
      # between the selected boards:
      
      filter(y > x + 1)
    
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
              
              # Get a one-row sample of the candidate data frame:
              
              draw <- slice_sample(.x$cands, n = 1)
              
              # If the candidates pool has been exhausted before the draws are
              # complete, this will end the process. tryCatch() and `repeat`
              # ensures that our function tries again:
              
              if (nrow(draw) == 0) stop("dead end")
              list(
                
                # Combine the previous draws with the current draw:
                
                draws = bind_rows(.x$draws, draw),
                
                # Subset the remaining candidates to just those that haven't 
                # been used:
                
                cands =
                  filter(
                    .x$cands,
                    !x %in% c(draw$x, draw$y),
                    !y %in% c(draw$x, draw$y)
                  )
              )
            },
            
            # .init is the starting point of the reduction -- it starts with the
            # original candidates frame and 0-row tibble of `draws` that will be
            # populated in each iteration:
            
            .init =
              list(
                draws = tibble(),
                cands = candidates
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

# wrapper function for a given patch --------------------------------------

get_coverboard_season <-
  function(.n_weeks = 12) {
    
    # All potential combinations of days and weeks:
    
    crossing(
      week = 1:.n_weeks,
      day = 1:3
    ) %>% 
      
      # Convert the above to a list, where each list item is a week:
      
      group_split(week) %>% 
      
      # Iterate across weeks:
      
      map(
        \(.x) {
          
          # Add coverboard sampling as columns:
          
          .x %>% 
            bind_cols(
              get_coverboard_order() %>% 
                
                # Giving reasonable names to our board checks:
                
                set_names(
                  str_c("board_", 1:2)
                )
            )
        }
      ) %>% 
      
      # Convert the list to a data frame:
      
      list_rbind()
  }

# schedule ----------------------------------------------------------------

patch_boards <-
  list.files(
    "pre-field_season/data/spatial/proc",
    pattern = "^patches.*[0-9].*geojson$"
  ) %>% 
  str_remove_all(".*[0-9]{1,2}_|\\.geojson") %>% 
  map_df(
    ~ get_coverboard_season(.n_weeks = 14) %>% 
      mutate(
        patch = .x,
        .before = 1
      )
  )

# One way we could do this for a sampling sheet:

patch_boards %>% 
  unite(
    "coverboards",
    matches("board"),
    sep = " "
  ) %>% 
  pivot_wider(
    names_from = day,
    values_from = coverboards,
    names_prefix = "day_"
  ) %>% 
  arrange(week, patch)
