
# Dashboard script for daily updates

# setup -------------------------------------------------------------------

library(glue)
library(here)
library(tidyverse)

system("git pull")

source(
  here(
    "scripts/utils/functions/time_and_date_functions.R"
  )
)

# target date -------------------------------------------------------------

target_date <-
  
  # On Sundays, define the week based on tomorrow's date:
  
  if (
    wday(
      today(),
      week_start = 1
    ) == 7
  ) {
    today() + 1
  } else {
    
    # Otherwise, it's today:
    
    today()
  }

# Set the date as an environment variable:

Sys.setenv(
  REFERENCE_DATE = as.character(target_date)
)

# download and pre-process field data and process outputs -----------------

source("scripts/utils/updater.R")

autopush_updates()

# printing ----------------------------------------------------------------

# Print maps:

list.files(
  here("outputs/print-outs/patch_maps"),
  pattern = "\\.png$",
  full.names = TRUE
) %>% 
  walk(
    ~ glue("lp '{.x}'") %>% 
      system()
  )

# Print schedule:

here("outputs/print-outs/schedule_pdf.pdf") %>% 
  {glue("lp {.}")} %>% 
  system()

# Print datasheets:

print_datasheets(
  # .datasheet = "coverboards",
  .datasheet = "nest_monitoring",
  # .datasheet = "nest_searching",
  # .datasheet = "point_counts",
  .copies = 1
)
