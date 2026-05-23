

# setup -------------------------------------------------------------------

library(sf)
library(tmap)
library(tidyverse)

read_dir <- "pre-field_season/data/spatial/proc"

# Read in patch data:

patches_spatial <- 
  list.files(
    read_dir,
    pattern = ".*[0-9]{1,2}_"
  ) %>% 
  map(
    ~ file.path(read_dir, .x) %>% 
      st_read(quiet = TRUE) %>% 
      filter(
        name == str_remove_all(.x, ".*[0-9]{1,2}_|\\.geojson")
      )
  ) %>% 
  bind_rows() 

# Patch names:

patch_names <- 
  c(
    "coyote",
    "banding",
    "firehouse",
    "forest_a",
    "forest_geo",
    "witch_hazel",
    "leech",
    "grassland_a",
    "forest_b",
    "grassland_b_fence",
    "grassland_b"
  )

# distance matrix of patches ----------------------------------------------

patches_dist <- 
  patches_spatial %>% 
  st_centroid() %>% 
  st_distance() %>% 
  as_tibble() %>% 
  set_names(patch_names) %>% 
  mutate(
    patches_1 = patch_names,
    .before = grassland_a
  ) %>% 
  pivot_longer(
    !patches_1,
    names_to = "patches_2",
    values_to = "dist"
  ) %>% 
  filter(
    patches_1 < patches_2
  )

# Weight patches by distance?

patches_dist

# starting values ---------------------------------------------------------

# Start date:

start_date <- as_date("2026-05-11")

# End date:

end_date <- as_date("2026-08-15")

# Sampling days:

days <- 
  tibble(
    date = 
      seq(
        start_date + 3,
        end_date,
        by = 1
      )
  ) %>% 
  filter(
    !wday(date) == 1
  )

# Initial status:

initial_status <- 
  tibble(
    patch = patches,
    last_checked =
      c(
        rep("2026-05-11", 3),
        rep("2026-05-12", 4),
        rep("2026-05-13", 4)
      ) %>% 
      as_date()
  )

# scheduling --------------------------------------------------------------

sample_day <- 
  function(
    .status,
    .current_date
  ) {
    
    patch_status <- .status$patch_status
    
    due_table <- 
      patch_status %>% 
      mutate(
        days_since = 
          as.numeric(.current_date - last_checked)
      )
    
    overdue <- 
      due_table %>% 
      filter(
        days_since >= 4
      )
    
    due <- 
      due_table %>% 
      filter(
        days_since >= 3,
        !patch %in% overdue$patch
      )
    
    potential_due <- 
      due_table %>% 
      filter(
        days_since >= 2,
        !patch %in% c(due$patch, overdue$patch)
      )
    
    selected <- character()
    
    # Prioritize overdue patches:
    
    if(nrow(overdue) > 0) {
      urgent <- 
        sample(
          overdue$patch,
          size = 
            min(
              4, 
              nrow(overdue)
            ),
          replace = FALSE
        )
    } 
    
    # Fill remaining slots with other due patches
    
    remaining_slots <- 4 - length(urgent)
    
    if(remaining_slots > 0) {
      
      additional <- 
        due$patch %>% 
        sample(
          size = 
            min(
              remaining_slots,
              nrow(due)
            ),
          replace = FALSE
        )
    }
    
    if (length(urgent) == 0) {
      selected <- c(additional)
    } else {
      selected <- c(urgent, additional)
    }
    
    # If still fewer than 4, fill with a random patch checked 2 days ago:
    
    remaining_slots <- 4 - length(selected)
    
    if(remaining_slots > 0) {
      
      filler <- 
        potential_due %>% 
        filter(
          !patch %in% selected
        ) %>%
        pull(patch) %>% 
        sample(
          size = remaining_slots,
          replace = FALSE
        )
      
      selected <- c(selected, filler)
    }
    
    # Update patch status:
    
    updated_status <- 
      patch_status %>% 
      mutate(
        last_checked =
          ifelse(
            patch %in% selected,
            .current_date,
            last_checked
          ) %>% 
          as_date()
      )
    
    list(
      patch_status = updated_status,
      schedule = 
        tibble(
          date = .current_date,
          patch = selected
        )
    )
  }

# iterate it --------------------------------------------------------------

accumulated <- 
  accumulate(
    .x = days$date,
    .f = sample_day,
    .init = 
      list(
        patch_status = initial_status,
        schedule = tibble()
      )
  ) 

schedule <- 
  accumulated %>% 
  length() %>% 
  seq_len() %>% 
  map_df(
    \(x) {
      accumulated %>% 
        pluck(x) %>% 
        pluck("schedule") 
    }
  ) %>% 
  mutate(
    interval =
      date - lag(date),
    .by = patch
  ) 

schedule %>%
  drop_na(interval) %>% 
  summarize(
    mean = mean(interval),
    min = min(interval),
    max = max(interval),
    .by = patch
  )

schedule %>% 
  drop_na(interval) %>% 
  summarize(
    n = n(),
    .by = c(interval, patch)
  ) %>% 
  pivot_wider(
    names_from = interval,
    values_from = n
  )



sample_day(
  .status = 
    list(
      patch_status = initial_status,
      schedule = tibble()
    ),
  .current_date = as_date("2026-05-11")
)













