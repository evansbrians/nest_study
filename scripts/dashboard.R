
# Dashboard script for daily updates

# setup -------------------------------------------------------------------

library(glue)
library(here)
library(tidyverse)

system("git pull")

googlesheets4::gs4_auth(email = TRUE)

# download data points from garmin ----------------------------------------

source("scripts/convert_gpx_geojson.R")

# download and pre-process field data -------------------------------------

source("scripts/updater.R")

# update the scheduling app and document ----------------------------------

# Update and render:

quarto::quarto_render("outputs/schedule/index.qmd")
quarto::quarto_render("outputs/print-outs/schedule_pdf.qmd")

# Push changes:

autopush_updates()

# update the combined app (currently test_pages) --------------------------

quarto::quarto_render(
  input = "outputs/test_pages",
  execute_dir = "outputs/test_pages"
)

autopush_updates()

# update maps -------------------------------------------------------------

# Google Earth:

source("scripts/update_google_earth.R")

# This part renders the phone apps (currently ios but soon to be in ios *and*
# Android!) and web pages:

quarto::quarto_render("scripts/nest_app/field_map.qmd")

# I'm not sure which web apps are being used in the field, so I'll update all
# of them:

file.path(
  "outputs",
  c("map_sandbox", "field_map"),
  "index.html"
) %>% 
  file.copy(
    "scripts/nest_app/index.html",
    .,
    overwrite = TRUE
  )

autopush_updates()

# PNG maps (printed maps):

source("scripts/update_map_print-outs.R")

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

source("scripts/functions.R")

print_datasheets(
  # .datasheet = "coverboards",
  .datasheet = "nest_monitoring",
  # .datasheet = "nest_searching",
  # .datasheet = "point_counts",
  .copies = 1
)
