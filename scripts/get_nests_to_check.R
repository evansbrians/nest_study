
library(tidyverse)

sheets_url <- "https://docs.google.com/spreadsheets/d"

# get and process schedule data -------------------------------------------

schedule <-
  file.path(sheets_url, "1b9GElqZ0-gTjd_LVyqab2STh7JOkG9knzkFy3aeHoeg") %>% 
  googlesheets4::read_sheet(
    sheet = "patch_counts",
    col_types = "c"
  ) %>% 
  mutate(
    date = as_date(date),
    patch = patch_count
  ) %>% 
  
  # Subset to between today and within the next week:
  
  filter(
    between(
      date,
      today(),
      today() + 6
    )
  ) %>% 
  
  # Subset to only relevant information:
  
  distinct(date, patch)

# get and process nest data -----------------------------------------------

# Nest-level data:

nest_level <- 
  file.path(sheets_url, "1iosPhbwDOVhIM4EkaeexnX0kRLsBqZKEuCbCsxFyMPs") %>% 
  googlesheets4::read_sheet(
    sheet = "nest_level",
    col_types = "c"
  ) %>% 
  select(nest_id, patch_id, nest_fate)

# Interval-level data:

nest_intervals <- 
  file.path(sheets_url, "1iosPhbwDOVhIM4EkaeexnX0kRLsBqZKEuCbCsxFyMPs") %>% 
  googlesheets4::read_sheet(
    sheet = "interval_level",
    col_types = "c"
  ) %>% 
  mutate(
    nest_id,
    date = as_date(date),
    across(
      host_eggs:host_young,
      ~ as.numeric(.x)
    ),
    .keep = "none"
  )

# combine and process nest data -------------------------------------------

nests_proc <-
  left_join(
    nest_level,
    nest_intervals,
    by = "nest_id"
  ) %>% 
  
  # Grab the last observation for each nest:
  
  slice_max(date, n = 1, by = nest_id) %>% 
  
  # Do not check if the nest fate is "Success" or "Failure":
  
  filter_out(
    nest_fate %in% c("Success", "Failure")
  ) %>% 
  
  # Earliest nest check is 3 days if there are eggs or young and 6 days if
  # there is no eggs or young:
  
  mutate(
    nest_id,
    patch = patch_id,
    check_freq = 
      case_when(
        host_eggs > 0 ~ 3,
        host_young > 0 ~ 3,
        .default = 6
      ),
    earliest_check = date + check_freq,
    .keep = "none"
  )

# determine the date of the next nest checks ------------------------------

# Join with schedule and  subset to the checks that will occur in next round of
# checks:

next_checks <- 
  nests_proc %>% 
  left_join(
    schedule,
    by = "patch",
    relationship = "many-to-many"
  ) %>% 
  filter(date >= earliest_check) %>% 
  slice_min(date, by = nest_id) %>% 
  mutate(
    check_1 = date,
    check_2 = date + check_freq,
    .keep = "unused"
  ) %>% 
  pivot_longer(
    check_1:check_2,
    names_to = NULL,
    values_to = "date"
  ) %>% 
  select(nest_id:patch, date) %>% 
  arrange(date, patch)

# Re-arrange by patch and day to view the nests you have to check on a given
# day:

next_checks %>% 
  summarize(
    check_nests = str_flatten(nest_id, collapse = ", "),
    .by = c(date, patch)
  ) %>% 
  write_rds("data/temp_nest_checking.rds")

rm(
  list = ls()
)
