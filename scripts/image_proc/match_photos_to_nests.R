
# Attach each exported photo to the nearest non-quail nest and flag the photos
# that sit within the verification radius of more than one nest.

# before your first run ---------------------------------------------------

# I published private keys in previous files and am now trying to fix that.
# Here's what we need to do:

# 1. Run this in your terminal to create a token for your R sessions:

ssh -i ~/.ssh/nest_vm_key ubuntu@snednestudy.duckdns.org \
>   'cd /opt/nest-api/server && sudo -u nestapi NEST_DB_PATH=/opt/nest-api/server/nest_study.sqlite Rscript mint_token.R mint TNS "Tara R"'

# 2. Copy the token

# 3. Run this in R:

usethis::edit_r_environ()

# 4. Write the following (replacing "[your token]" with the token you copied to
# your clipboard) in the .Renviron file:

NEST_API_TOKEN=[your token]

# 5. Save the .Renvion file and restart R

# setup -------------------------------------------------------------------

library(cli)
library(httr)
library(jsonlite)
library(sf)
library(tidyverse)

source("scripts/utils/functions/db_functions.R")

base_url <- "https://snednestudy.duckdns.org"

# The token is personal and this script is public, so it is read from the R
# environment rather than written here.

token <- Sys.getenv("NEST_API_TOKEN")

if (!nzchar(token)) {
  cli_abort(
    c(
      "NEST_API_TOKEN is not set.",
      "i" =
        "Run usethis::edit_r_environ(), add a line reading
         NEST_API_TOKEN=your_token, then restart R.",
      "i" =
        "The project .Renviron is gitignored, so the token is safe there."
    )
  )
}

auth <-
  add_headers(
    Authorization =
      str_c("Bearer ", token),
    Accept =
      "application/json"
  )

# Two nests this close cannot be told apart from a phone's GPS fix, so every
# nest inside the radius is named is flagged and a note will be added:

verify_radius_m <- 10

# A nearest nest further than this is almost certainly the wrong nest, so those
# photos are also flagged.

max_expected_m <- 20

# read photo metadata  ----------------------------------------------------

photo_meta <-
  read_csv(
    "data/photos/bulk/photo_manifest.csv",
    col_types =
      cols(
        .default = col_character(),
        latitude = col_double(),
        longitude = col_double(),
        elevation = col_double(),
        bearing = col_double(),
        horizontal_accuracy = col_double()
      )
  )

# GPS time is UTC and the camera clock is the fallback and is read as ET:

photo_points <-
  photo_meta %>%
  drop_na(longitude, latitude) %>% 
  distinct(
    photo_id,
    .keep_all = TRUE
  ) %>%
  mutate(
    taken_at =
      taken_gps_utc %>%
      ymd_hms(
        tz = "UTC",
        quiet = TRUE
      ) %>%
      coalesce(
        ymd_hms(
          taken_local,
          tz = "America/New_York",
          quiet = TRUE
        )
      ) %>%
      format(
        "%Y-%m-%dT%H:%M:%SZ",
        tz = "UTC"
      )
  ) %>%
  st_as_sf(
    coords = c("longitude", "latitude"),
    crs = 4326,
    remove = FALSE
  )

# read the nests ----------------------------------------------------------

# Nest waypoints are geojson, so the coordinates need to be extracted from the
# geometry list and the properties need their prefix stripped.

nest_waypoints <-
  query_api(
    .query = "gps_points?class=nest",
    .tibbular = FALSE
  ) %>%
  pluck("features") %>%
  as_tibble() %>%
  janitor::clean_names() %>%
  mutate(
    longitude =
      geometry_coordinates %>%
      map_dbl(1),
    latitude =
      geometry_coordinates %>%
      map_dbl(2)
  ) %>%
  rename_with(
    ~ str_remove(.x, "^properties_"),
    starts_with("properties_")
  ) %>%
  select(
    point_id,
    longitude,
    latitude
  )

# Nest locations as an sf file and removing NQ nests:

nest_locations <-
  query_api("nests") %>%
  filter(
    !str_starts(nest_id, "NQ"),
    !is.na(gps_point_id)
  ) %>%
  select(
    nest_id,
    gps_point_id,
    patch_id,
    species_common
  ) %>%
  inner_join(
    nest_waypoints,
    by = join_by(gps_point_id == point_id)
  ) %>%
  st_as_sf(
    coords = c("longitude", "latitude"),
    crs = 4326
  )

# measure distances -------------------------------------------------------

# st_distance returns a photo-by-nest matrix in column-major order, so photos
# cycle within each nest's block after flattening:

photo_nest_distance <-
  photo_points %>%
  st_distance(nest_locations) %>%
  as.numeric()

distance_table <-
  tibble(
    photo_id =
      photo_points$photo_id %>%
      rep(times = nrow(nest_locations)),
    nest_id =
      nest_locations$nest_id %>%
      rep(each = nrow(photo_points)),
    distance_m = photo_nest_distance
  )

nearest_nest <-
  distance_table %>%
  slice_min(
    distance_m,
    n = 1,
    by = photo_id,
    with_ties = FALSE
  ) %>%
  rename(nearest_distance_m = distance_m)

nests_within_radius <-
  distance_table %>%
  filter(distance_m <= verify_radius_m) %>%
  arrange(
    photo_id,
    distance_m
  ) %>%
  summarize(
    n_nests_within = n(),
    nest_list =
      str_flatten_comma(
        nest_id,
        last =
          if (n() > 2) ", and " else " and "
      ),
    .by = photo_id
  )

# create the match table and write ----------------------------------------

photo_matches <-
  photo_points %>%
  st_drop_geometry() %>%
  left_join(
    nearest_nest,
    by = "photo_id"
  ) %>%
  left_join(
    nests_within_radius,
    by = "photo_id"
  ) %>%
  left_join(
    nest_locations %>%
      st_drop_geometry() %>%
      rename(point_id = gps_point_id),
    by = "nest_id"
  ) %>%
  mutate(
    n_nests_within =
      n_nests_within %>%
      replace_na(0L),
    distance_flag = 
      n_nests_within > 1 |
      nearest_distance_m > max_expected_m,
    distance_m = nearest_distance_m,
    notes =
      case_when(
        distance_flag ~
          glue::glue(
            "Nests {nest_list} are within ",
            "{verify_radius_m} m of the location of this photo"
          ) %>%
          as.character()
      )
  ) %>%
  select(
    photo_id,
    nest_id,
    distance_m,
    distance_flag,
    n_nests_within,
    file_path,
    patch_id,
    species_common,
    latitude,
    longitude,
    bearing,
    taken_at,
    notes
  ) %>%
  arrange(
    desc(distance_flag),
    nest_id,
    photo_id
  )

photo_matches %>%
  write_csv("data/photos/photo_nest_matches.csv")
