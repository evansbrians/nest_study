
# Create a database for the nest study

# set-up ------------------------------------------------------------------

library(DBI)
library(RSQLite)
library(stringi)
library(tidyverse)

# Read in the existing data:

read_rds("data/field_data.rds") %>% 
  list2env(.GlobalEnv)

# Function to generate a random string and paste onto a table-specific prefix:

generate_key <- 
  function(
    .data,
    .prefix,
    .key,
    .symbols = 5,
    .col_placement
  ) {
    .data %>% 
      mutate(
        "{.key}_id" :=
          str_c(
            .prefix,
            "-",
            stri_rand_strings(
              nrow(.),
              length = .symbols
            )
          ),
        .before = .col_placement
      )
  }

# separate data into tables -----------------------------------------------

# Visits table:

visits %>% 
  generate_key(
    .prefix = "vts",
    .key = "visit",
    .col_placement = "date"
  ) %>% 
  unnest(patch_level) %>% 
  
  # Patch visits table:
  
  generate_key(
    .prefix = "pv",
    .key = "patch_visit",
    .col_placement = "patch"
  ) %>% 
  
  # Patch visit activities table:
  
  unnest(activities) %>% 
  generate_key(
    .prefix = "pva",
    .key = "patch_activity",
    .col_placement = "activity"
  )



# 
# point_count <- 
#   point_counts %>% 
#   select()

# make a database ---------------------------------------------------------

nest_study_database <-
  dbConnect(
    SQLite(),
    "nest_study_database.sqlite"
  )

# write existing data to the database -------------------------------------

# dbWriteTable(
#   conn = nest_study_database,
#   name = "",
#   value =
# )
