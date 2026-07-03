
# Dashboard script for daily updates

# setup -------------------------------------------------------------------

library(glue)
library(here)
library(tidyverse)

system("git pull")

source(
  here("scripts/utils/functions/time_and_date_functions.R"
)
)

# download data points from garmin ----------------------------------------

# This is just a fail safe in case you are still using the Garmin:

source("scripts/spatial/convert_gpx_geojson.R")

# download and pre-process field data and process outputs -----------------

# Weather woes:

push_schedule(
  today()
) 

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

source("scripts/utils/functions/utility_functions.R")

print_datasheets(
  # .datasheet = "coverboards",
  .datasheet = "nest_monitoring",
  # .datasheet = "nest_searching",
  # .datasheet = "point_counts",
  .copies = 1
)
