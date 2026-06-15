
# I think the only way to satisfy the for next nest searches and sampling order
# conditions is to just do a simple rotation across patches!

# setup -------------------------------------------------------------------

library(tidyverse)

# Get schedule:

schedule_raw <- 
  read_rds("data/season_schedule.rds")

schedule_patch_counts <-
  schedule_raw %>% 
  unnest(patch_counts)

# the logic ---------------------------------------------------------------

# Starting point (using a single patch):

start <-
  tibble(
    week = 1,
    day_counter = 1,
    patch = 
      c(
        "coyote", 
        "witch_hazel", 
        rep("firehouse", 2),
        "witch_hazel"
      ),
    activity = 
      c(
        rep("check", 3),
        rep("search", 2)
      )
  )

# Rotation across patches:

accumulate(
  1:12, 
  ~ .x %>% 
    mutate(
      
      # Day counter
      
      day_counter = day_counter + 1,
      
      # Integer division returns to whole number from the day division:
      
      week = (day_counter + 1) %/% 2,
      
      # Patch order rotation:
      
      patch = 
        patch[
          c(2, 3, 1, 1, 3)
        ]
    ), 
  .init = start
) %>% 
  bind_rows()

# application -------------------------------------------------------------

## prepare data for search ordering ---------------------------------------

check_search_start <- 
  schedule_patch_counts %>%
  
  # Rename the patch columns:
  
  rename(patch = patch_count) %>% 
  
  # Make a patch group column:
  
  mutate(
    patch_group = 
      day %>% 
      as.character() %>% 
      fct_collapse(
        c = c("Mon", "Thu"),
        j = c("Tue", "Fri"),
        b = c("Wed", "Sat"),
        no_patches = "Sun"
      ) %>% 
      fct_relevel(
        "c",
        "j",
        "b",
        "no_patches"
      )
  ) %>% 
  
  # Subset to unique values of  patch group and patch:
  
  distinct(
    patch_group, 
    patch
  ) %>% 
  
  mutate(
    
    # Set the start week to 1 (we'll adjust this later):
    
    week = 1,
    
    # Add a day counter:
    
    day_counter = 1,
    
    # Define the activity:
    
    activity = "check",
    .before = 1
  ) %>% 
  
  # Move activity to the end:
  
  relocate(activity, .after = patch) %>% 
  
  # Split patches by group:
  
  split(.$patch_group) %>% 
  
  # Add the searching to each group
  
  imap(
    \(.patch_group, .id) {
      if(.id != "no_patches") {
        .patch_group %>% 
          
          # Add searching for the first event of each group:
          
          slice(3, 2) %>% 
          mutate(activity = "search") %>% 
          bind_rows(.patch_group, .)
      } else {
        mutate(.patch_group, activity = "-")
      }
    }
  )

## generate a patch search order as above ---------------------------------

check_search_order <-
  check_search_start %>% 
  map(
    \(.patch_group) {
      accumulate(
        1:16,
        ~ .x %>% 
          mutate(
            
            # Day counter
            
            day_counter = day_counter + 1,
            
            # Integer division returns to whole number from the day division:
            
            week = (day_counter + 1) %/% 2
          ) %>% 
          
          # The one big change is accounting for Sundays:
          
          {
            if(unique(.$patch_group) == "no_patches") {
              .
            } else {
              mutate(
                .,
                patch = 
                  patch[
                    c(2, 3, 1, 1, 3)
                  ]
              )
            }
          },
        .init = .patch_group
      ) %>% 
        bind_rows()
    }
  ) %>% 
  bind_rows() %>% 
  arrange(week, day_counter) %>% 
  
  # Add current date info:
  
  mutate(
    date = today() + consecutive_id(patch_group),
    .before = week
  ) %>% 
  
  # Add patch order:
  
  mutate(
    patch_order = 
      if (n() > 1) row_number() else 0,
    .by = date,
    .before = patch
  ) %>% 
  
  # Remove columns that would interfere with the schedule columns:
  
  select(
    date, 
    patch_order,
    patch,
    activity
  )

# Searches:

check_search_order %>%
  filter(activity == "search") %>% 
  select(date, patch_order:patch) %>% 
  inner_join(
    schedule_raw %>%
      select(!patch_counts),
    by = "date"
  )

# Nest checks:

check_search_order %>%
  filter(activity == "check") %>% 
  select(date, patch_order:patch) %>% 
  inner_join(
    schedule_raw %>%
      unnest(patch_counts) %>% 
      unnest(boards) %>% 
      select(-patch_order),
    by = join_by(date, patch == patch_count)
  )

# Then bind, add the Sundays back in, and nest the columns and you should be good to go!?



