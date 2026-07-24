
# setup -------------------------------------------------------------------

library(cli)
library(httr)
library(jsonlite)
library(tidyverse)

source("scripts/utils/functions/db_functions.R")

base_url <- "https://snednestudy.duckdns.org"

# Define API password:

token <- "a5d11ba12d29bdb83b0a5e4806fe111dbb740d6001499c2cdc171440cb05f357"

# Assign authorization (because it can be annoying to do each time):

auth <-
  add_headers(
    Authorization =
      str_c("Bearer ", token),
    Accept =
      "application/json"
  )



# API endpoints -----------------------------------------------------------

# This is a look at what you can query. Any of these can be thought of as tables
# (or lists of tables) in the database:

endpoints <-

  # Query the api:

  query_api(
    .query = "openapi.json",
    .tibbular = FALSE
  ) %>%

  # Subset:

  pluck("paths") %>%

  # Return variable of interest:

  names() %>%
  as_tibble_col("endpoints")

# debugging visibility issues ---------------------------------------------

# Based on the various transparency issues, I made a view table that the app
# uses to define icons:

query_api("map_points")

# You can query that table:

query_api("map_points?class=coverboard") %>%
  filter(status == "Scheduled today")

# query nests -------------------------------------------------------------

# Get a full table of data from the api.

query_api("nests")

# Note that some outputs are lists, so you don't want the response to be a
# tibble For example, "lookups" power the dropdown menues:

query_api("lookups", .tibbular = FALSE)

# You'll see that some endpoints allow you to dig a bit deeper (see all of
# the associated data as a list):

query_api("nests/N103", .tibbular = FALSE)

# You can extract a list item with purrr:

query_api("nests/N103", .tibbular = FALSE) %>%
  pluck("intervals")

# Or extract using the query itself (here a tibble, so we can use my `tibbular =
# TRUE` switch):

query_api("nests/N103/intervals")

# There are some endpoint parameters that can simplify searching. You can do
# so with "?[parameter]=[value]":

query_api("nests?patch=witch_hazel")

# You can add multiple parameters by separating queries with `&`:

query_api("nests?current=true&patch=witch_hazel")

# query gps ---------------------------------------------------------------

# The shape of some objects can be tricky:

query_api("gps_points")

# ... but we can wrangle out the awkwardness:

query_api("gps_points", .tibbular = FALSE) %>%

  # The information is in the "features" list:

  pluck("features") %>%
  as_tibble() %>%
  janitor::clean_names() %>%

  # Geometry is a list of 2-value vectors:

  mutate(
    lon = map_dbl(geometry_coordinates, 1),
    lat = map_dbl(geometry_coordinates, 2),
    .keep = "unused",
    .after = geometry_type
  ) %>%

  # No one likes unnecessarily long names:

  rename_with(
    ~ str_remove(.x, "^properties\\."),
    starts_with("properties.")
  )

# Note that we have parameters for GPS as well:

query_api("gps_points?class=coverboard")

# query schedule ----------------------------------------------------------

query_api("schedule")

# Parameters for the schedule may be super useful:

query_api("schedule?week=9")

# ... but of course:

query_api("schedule") %>%
  filter(week == 9)

# query photos --------------------------------------------------------------

# Photo metadata is a normal table, same as nests/gps_points:

query_api("photos")

# Filter to one nest's photos:

query_api("photos?nest_id=N103")

# The image bytes themselves need download_photo() -- query_api() only
# handles JSON:

query_api("photos?nest_id=N103") %>%
  pull(photo_id) %>%
  first() %>%
  download_photo()
