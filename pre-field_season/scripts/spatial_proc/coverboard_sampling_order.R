# Script for generating a random coverboard order for each week, where no
# coverboard is sample more than once per week and adjacent coverbaords are
# not sampled.

# setup -------------------------------------------------------------------

library(tidyverse)

# function to calculate the coverboard order for a given week -------------

get_coverboard_order <-
  function(
    pool = 1:6, 
    n_draws = 3
  ) {
    
    candidates <-
      crossing(x = pool, y = pool) %>%
      filter(y > x + 1)
    
    repeat {
      result <-
        tryCatch(
          reduce(
            seq_len(n_draws),
            ~ {
              draw <- slice_sample(.x$cands, n = 1)
              if (nrow(draw) == 0) stop("dead end")
              list(
                draws = bind_rows(.x$draws, draw),
                cands =
                  filter(
                    .x$cands,
                    !x %in% c(draw$x, draw$y),
                    !y %in% c(draw$x, draw$y)
                  )
              )
            },
            .init =
              list(
                draws = tibble(),
                cands = candidates
              )
          ) %>%
            pluck("draws"),
          error = function(e) NULL
        )
      
      if(
        !is.null(result) &&
        nrow(result) == n_draws
      ) return(result)
    }
  }

# wrapper function for a given patch --------------------------------------

get_coverboard_season <-
  function(.n_weeks = 12) {
    crossing(
      week = 1:.n_weeks,
      day = str_c("day_", 1:3)
    ) %>% 
      group_split(week) %>% 
      map(
        \(.x) {
          .x %>% 
            bind_cols(
              get_coverboard_order()
            )
        }
      ) %>% 
      list_rbind()
  }
