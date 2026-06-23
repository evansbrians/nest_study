# Create an interactive leaflet map for hosting on GitHub pages

# setup --------------------------------------------------------------------

library(glue)
library(leaflet)
library(sf)
library(htmlwidgets)
library(htmltools)
library(tidyverse)

# Confirm here::here() is actually landing on our project root (where
# scripts/, data/ and icons/ live). If it didn't, fail with a message (because
# default messages were confusing and generated rabbit holes).

if (!file.exists(here::here("scripts/functions.R"))) {
  stop(
    "here::here() did not resolve to the project root (it gave: ",
    here::here(),
    "). Look for a stray .Rproj/.here/.git/_quarto.yml in a subfolder."
  )
}

source(here::here("scripts/functions.R"))

# Function to make popup:

make_nest_popup <-
  function(.x) {
    glue_data(
      .x,
      "
      <div style='font-family: Times;'>
      <h3><strong>{nest_id}</strong>. Species: {species}</h3>
      <ul>
      <li><strong>Patch</strong>: {patch_id}</li>
      <li><strong>Plant species</strong>: {substrate}</li>
      <li><strong>Height</strong>: {height}</li>
      <li><strong>Location description</strong>: {location_description}</li>
      <li><strong>Discovered on</strong>: {discovery_date}</li>
      <li><strong>Last checked on</strong>: {last_check}</li>
      <li><strong>Current status</strong>: {last_status}</li>
      </ul>
      </div>
      "
    )
  }

# Basemap:

basemap <-
  leaflet() %>%
  
  # Base tile layers:
  
  addProviderTiles(
    providers$Esri.WorldImagery,
    group = "Satellite",
    options = tileOptions(maxZoom = 21, maxNativeZoom = 19)
  ) %>%
  addProviderTiles(
    providers$OpenStreetMap,
    group = "Street Map"
  ) %>%
  
  # Precipitation:
  
  addWMSTiles(
    baseUrl =
      "https://opengeo.ncep.noaa.gov/geoserver/conus/conus_cref_qcd/ows",
    layers = "conus_cref_qcd", 
    options = WMSTileOptions(
      format = "image/png",
      transparent = TRUE,
      opacity = 0.50,
      version = "1.3.0"
    ),
    group = "Precipitation",
    attribution = "Precipitation &copy; NOAA/NWS OpenGeo"
  ) %>% 
  
  # Add weather radar layer:
  
  addWMSTiles(
    baseUrl = "https://opengeo.ncep.noaa.gov/geoserver/klwx/ows",
    layers = "klwx_sr_bref", 
    options = 
      WMSTileOptions(
        format = "image/png", 
        transparent = TRUE,
        opacity = 0.65
      ),
    group = "NEXRAD",
    attribution = "NEXRAD &copy; NOAA/NWS"
  )

# data gathering and pre-processing ----------------------------------------

# Spatial data:

list.files(
  here::here("data/spatial"),
  pattern = "geojson",
  full.names = TRUE
) %>%
  set_names_from_path() %>%
  set_names(
    names(.) %>% 
      str_remove("_locations") %>% 
      str_replace("(?<!s)$", "s")
  ) %>% 
  map(
    ~ st_read(.x, quiet = TRUE) %>%
      st_transform(4326) %>% 
      
      # Add icon ids:
      
      mutate(
        icon_id = 
          case_when(
            str_detect(name, "cb|cam") ~ 
              str_extract(name, "(cb|cam)_[0-6]$"),
            str_detect(name, "^N") ~ "nest",
            str_detect(name, "^point") ~ "pc",
            .default = "patch"
          ),
        .after = name
      )
  ) %>% 
  list2env(.GlobalEnv)

# Nest data:

nests_start <-
  read_rds(here::here("data/field_data.rds")) %>%
  pluck("nests") %>% 
  unnest(interval_data)

# Icons:

icons <-
  list.files(
    here::here("icons/map_icons"),
    pattern = "png$",
    full.names = TRUE
  ) %>% 
  set_names_from_path() %>% 
  map(
    ~ makeIcon(
      iconUrl = base64enc::dataURI(file = .x, mime = "image/png"),
      iconWidth = 20.25,
      iconHeight = 20.25,
      iconAnchorX = 10.125,
      iconAnchorY = 10.125
    )
  ) %>% 
  do.call(iconList, .)

# Simplify path lines:

paths <-
  tracks %>% 
  filter(
    !str_detect(name, "line")
  ) %>% 
  rmapshaper::ms_simplify(keep = 0.20)

# nest status --------------------------------------------------------------

# Read and process nest data for map:

# Nest popup:

nest_popup <- 
  nests_start %>% 
  summarize(
    last_check = last(date), 
    last_status = last(nest_status),
    .by = 
      c(
        nest_id:patch_id, 
        height,
        substrate, 
        location_description,
        discovery_date
      )
  ) %>% 
  mutate(
    across(
      where(is.character),
      ~ replace_na(.x, "Unknown")
    ),
    nest_popup =
      pick(
        everything()
      ) %>%
      make_nest_popup() %>%
      as.character()
  ) %>%
  select(nest_id, nest_popup)

nests_coded <- 
  nests_start %>% 
  mutate(
    nest_id, 
    nest_fate, 
    date = as_date(date),
    across(
      host_eggs:host_young,
      ~ as.numeric(.x)
    ),
    .keep = "none"
  ) %>% 
  slice_max(
    date,
    by = nest_id,
    with_ties = FALSE
  ) %>% 
  mutate(
    name = nest_id,
    icon_id = 
      case_when(
        nest_fate %in% c("Success", "Failure") ~ "nest_old",
        host_eggs == 0 & 
          host_young == 0 ~  "nest_building",
        is.na(host_eggs) & is.na(host_young) ~ "nest_unknown",
        .default = "nest_active"
      ),
    .keep = "none"
  ) %>% 
  left_join(
    select(nests, !icon_id),
    .,
    by = "name"
  ) %>% 
  
  # Add nest popup:
  
  left_join(
    nest_popup,
    by = join_by(name == nest_id)
  )

# build map ----------------------------------------------------------------

map <-
  basemap %>% 
  
  # Patches drawn first so point layers render on top:
  
  addPolygons(
    data = patches,
    fillColor = "#ffffff",
    fillOpacity = 0.2,
    color = "#0000ff",
    weight = 1.5,
    opacity = 0.5,
    popup = ~ name,
    label = ~ name,
    group = "Patches"
  ) %>%
  
  addPolylines(
    data = paths,
    weight = 3,
    opacity = 0.7,
    dashArray = "2, 5",
    color = "#ffff00",
    group = "Paths"
  ) %>%
  
  # Nests
  
  addMarkers(
    data = nests_coded,
    icon = ~ icons[icon_id],
    popup = ~ nest_popup,
    group = "Nests"
  ) %>% 
  
  # Coverboards:
  
  addMarkers(
    data = coverboards,
    icon = ~ icons[icon_id],
    popup = ~ name,
    label = ~ name,
    group = "Coverboards"
  ) %>%
  
  # Trail cameras:
  
  addMarkers(
    data = trailcams,
    icon = ~ icons[icon_id],
    popup = ~ name,
    label = ~ name,
    group = "Trail Cameras"
  ) %>%
  
  # Point counts:
  
  addMarkers(
    data = point_counts,
    icon = icons["pc"],
    popup = ~ name,
    label = ~ name,
    group = "Point Counts"
  ) %>%
  
  # Layer control:
  
  addLayersControl(
    baseGroups = c("Satellite", "Street Map"),
    overlayGroups = 
      c(
        "Precipitation",
        "NEXRAD",
        "Patches",
        "Coverboards",
        "Trail Cameras",
        "Point Counts",
        "Nests"
      ),
    options = layersControlOptions(collapsed = TRUE)
  ) %>%
  
  # Scale bar for distance reference:
  
  addScaleBar(
    position = "bottomleft",
    options = 
      scaleBarOptions(
        maxWidth = 300,
        metric = TRUE,
        imperial = FALSE
      )
  ) %>% 
  
  # Hide points unless selected otherwise:
  
  hideGroup(
    c(
      "Precipitation",
      "NEXRAD",
      "Coverboards",
      "Trail Cameras", 
      "Point Counts",
      "Nests"
    )
  )

# bigger controls and scale bar --------------------------------------------

map_mobile_friendly <-
  map %>%
  htmlwidgets::appendContent(
    htmltools::tags$style(
      htmltools::HTML(
        read_file(here::here("scripts/nest_app/map_styles.css"))
      )
    )
  )

# add location tracking ----------------------------------------------------

map_tracking <-
  map_mobile_friendly %>%
  htmlwidgets::onRender(
    read_file(here::here("scripts/nest_app/map_tracking.js"))
  )

# add weather toggle support -----------------------------------------------

# A separate onRender so it runs on desktop too (map_tracking.js returns
# early on non-mobile):

map_tracking <-
  map_tracking %>%
  htmlwidgets::onRender(
    read_file(here::here("scripts/nest_app/map_weather.js"))
  )

# embed patch geometries for the patch filter ------------------------------

patch_geo_json <-
  tryCatch(
    {
      pg <- sf::st_transform(patches, 4326)

      geoms <-
        seq_len(nrow(pg)) %>%
        map(
          function(i) {
            cc <- sf::st_coordinates(sf::st_geometry(pg)[i])
            ring_key <-
              if ("L2" %in% colnames(cc)) {
                str_c(cc[, "L2"], cc[, "L1"], sep = "-")
              } else {
                cc[, "L1"]
              }
            as.data.frame(cc) %>%
              split(ring_key) %>%
              map(
                function(r) {
                  map2(r$Y, r$X, ~ c(.x, .y))
                }
              ) %>%
              unname()
          }
        ) %>%
        set_names(as.character(pg$name))

      jsonlite::toJSON(geoms, auto_unbox = TRUE)
    },
    error = function(e) "{}"
  )

map_tracking <-
  map_tracking %>%
  htmlwidgets::appendContent(
    htmltools::tags$script(
      htmltools::HTML(
        str_c("window.fieldPatches = ", patch_geo_json, ";")
      )
    )
  )

# embed today's schedule subset --------------------------------------------

# Sources schedule_for_map.R (run from the project root, since it uses bare
# relative paths) and computes today's patches plus which features are
# scheduled today.

field_today_json <-
  tryCatch(
    {
      sched_env <- new.env()

      source(
        here::here("scripts/nest_app/schedule_for_map.R"),
        local = sched_env
      )

      today <- Sys.Date()

      # The schedule stores a bare patch + integer id, but the map markers are
      # named "<patch>_cb_<n>" / "<patch>_trailcam_<n>" (and nests by nest_id),
      # so rebuild the full marker names to match against.

      sb <-
        sched_env$schedule %>%
        dplyr::filter(date == today)

      sc <-
        sched_env$next_pred_cam_maintenance %>%
        dplyr::filter(date == today)

      tp   <- unique(as.character(sb$patch))
      tb   <- unique(str_c(sb$patch, "_cb_", sb$board_id))
      tcam <- unique(str_c(sc$patch, "_trailcam_", sc$camera_id))

      tn <-
        sched_env$next_checks %>%
        dplyr::filter(date == today) %>%
        dplyr::pull(nest_id) %>%
        unique()

      # "lat,lng" key (6 dp) for every feature in a layer -- matches the keys
      # map_weather.js builds from the marker coordinates.

      keyfun <-
        function(sfobj) {
          cc <- sf::st_coordinates(sf::st_transform(sfobj, 4326))
          sprintf("%.6f,%.6f", cc[, "Y"], cc[, "X"])
        }

      # Keys of the markers in a layer that are NOT scheduled today.

      fade_keys <-
        function(sfobj, scheduled) {
          keyfun(sfobj)[
            !(as.character(sfobj$name) %in% as.character(scheduled))
          ]
        }

      # Half-opacity for every not-scheduled marker, keyed by "lat,lng".

      not_scheduled_keys <-
        c(
          fade_keys(coverboards, tb),
          fade_keys(nests, tn),
          fade_keys(trailcams, tcam)
        )

      fade <-
        not_scheduled_keys %>%
        map(~ 0.5) %>%
        set_names(not_scheduled_keys)

      # as.list(tp) keeps `patches` a JSON array even when only one patch is
      # scheduled today (auto_unbox would otherwise emit a bare string).

      jsonlite::toJSON(
        list(patches = as.list(as.character(tp)), fade = fade),
        auto_unbox = TRUE
      )
    },
    error = function(e) "null"
  )

map_tracking <-
  map_tracking %>%
  htmlwidgets::appendContent(
    htmltools::tags$script(
      htmltools::HTML(
        str_c("window.fieldToday = ", field_today_json, ";")
      )
    )
  )

# embed offline satellite tiles --------------------------------------------

# Pre-fetch Esri World Imagery tiles

offline_zooms  <- 16:19     # native zooms stored; higher zooms overzoom z19
offline_buffer <- 50        # meters of margin around each patch
tile_cache_dir <- here::here("scripts/nest_app/offline_tiles")

# Which patches to embed offline imagery:

offline_patches <- c("coyote", "witch_hazel", "leech")

.deg2tile <- 
  function(lat, lng, z) {
    n <- 2^z
    latr <- lat * pi / 180
    c(
      x = floor((lng + 180) / 360 * n),
      y = floor((1 - log(tan(latr) + 1 / cos(latr)) / pi) / 2 * n)
    )
  }

offline_tiles_json <-
  tryCatch(
    {
      dir.create(tile_cache_dir, showWarnings = FALSE, recursive = TRUE)

      pg <- sf::st_transform(patches, 4326)

      if (!is.null(offline_patches)) {
        pg <-
          pg %>%
          filter(as.character(name) %in% offline_patches)
      }

      # Every unique z/x/y tile covering each selected patch (+ buffer) across
      # the offline zooms.

      tiles_index <-
        seq_len(nrow(pg)) %>%
        map(
          function(i) {
            bb   <- sf::st_bbox(sf::st_geometry(pg)[i])
            mlat <- as.numeric((bb["ymin"] + bb["ymax"]) / 2)
            dlat <- offline_buffer / 110540
            dlng <- offline_buffer / (111320 * cos(mlat * pi / 180))

            offline_zooms %>%
              map(
                function(z) {
                  tl <-
                    .deg2tile(
                      as.numeric(bb["ymax"]) + dlat,
                      as.numeric(bb["xmin"]) - dlng,
                      z
                    )
                  brc <-
                    .deg2tile(
                      as.numeric(bb["ymin"]) - dlat,
                      as.numeric(bb["xmax"]) + dlng,
                      z
                    )
                  expand_grid(
                    z = z,
                    x = tl["x"]:brc["x"],
                    y = tl["y"]:brc["y"]
                  )
                }
              ) %>%
              list_rbind()
          }
        ) %>%
        list_rbind() %>%
        distinct()

      keys <-
        str_c(
          tiles_index$z,
          tiles_index$x,
          tiles_index$y,
          sep = "/"
        )

      files <-
        file.path(
          tile_cache_dir,
          str_c(tiles_index$z, "_", tiles_index$x, "_", tiles_index$y, ".jpg")
        )

      # Esri tile path order is z / y / x.

      urls <-
        sprintf(
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/%d/%d/%d",
          tiles_index$z,
          tiles_index$y,
          tiles_index$x
        )

      sizes <- file.info(files)$size
      need  <- is.na(sizes) | sizes == 0

      if (any(need)) {
        if (requireNamespace("curl", quietly = TRUE)) {
          try(
            curl::multi_download(
              urls[need],
              files[need],
              progress = FALSE
            ),
            silent = TRUE
          )
        } else {
          walk2(
            urls[need],
            files[need],
            function(url, file) {
              try(
                utils::download.file(url, file, mode = "wb", quiet = TRUE),
                silent = TRUE
              )
            }
          )
        }
      }

      # Build the data-URI dictionary from whatever is on disk. Skip tiny blank
      # responses Esri returns where it has no imagery.

      tiles <-
        map2(
          keys,
          files,
          function(key, file) {
            if (!file.exists(file)) {
              return(NULL)
            }
            sz <- file.info(file)$size
            if (is.na(sz) || sz <= 600) {
              return(NULL)
            }
            str_c(
              "data:image/jpeg;base64,",
              jsonlite::base64_enc(readBin(file, "raw", n = sz))
            )
          }
        ) %>%
        set_names(keys) %>%
        compact()

      jsonlite::toJSON(tiles, auto_unbox = TRUE)
    },
    error = function(e) "{}"
  )

map_tracking <-
  map_tracking %>%
  htmlwidgets::appendContent(
    htmltools::tags$script(
      htmltools::HTML(
        str_c("window.fieldOfflineTiles = ", offline_tiles_json, ";")
      )
    )
  )

# embed navigable map points -----------------------------------------------

# Coverboards, trail cameras and nests are embedded as window.fieldNavPoints so
# the Waypoint manager can list and navigate to them:

nav_points_json <-
  tryCatch(
    {
      nav_df <-
        function(sfobj, type) {
          cc <- sf::st_coordinates(sf::st_transform(sfobj, 4326))
          tibble(
            name = as.character(sfobj$name),
            lat  = cc[, "Y"],
            lng  = cc[, "X"],
            type = type
          )
        }

      list(
        Nest = nests,
        Coverboard = coverboards,
        `Trail camera` = trailcams
      ) %>%
        imap(nav_df) %>%
        list_rbind() %>%
        jsonlite::toJSON(dataframe = "rows")
    },
    error = function(e) "[]"
  )

map_tracking <-
  map_tracking %>%
  htmlwidgets::appendContent(
    htmltools::tags$script(
      htmltools::HTML(
        str_c("window.fieldNavPoints = ", nav_points_json, ";")
      )
    )
  )

# return the widget --------------------------------------------------------

map_tracking

# end session --------------------------------------------------------------

# Update git:

autopush_updates()

# Clear global environment:

rm(
  list = ls()
)
