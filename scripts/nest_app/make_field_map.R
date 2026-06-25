# Create an interactive leaflet map for hosting on GitHub pages

# setup --------------------------------------------------------------------

library(glue)
library(here)
library(leaflet)
library(sf)
library(htmlwidgets)
library(htmltools)
library(tidyverse)

# Basic functions file:

source(
  here("scripts/utils/functions/utility_functions.R")
)

# Functions for the app:

source(
  here("scripts/nest_app/app_functions.R")
)

# basemap -----------------------------------------------------------------

basemap <-
  leaflet() %>%
  
  # Base tile layers:
  
  addProviderTiles(
    providers$Esri.WorldImagery,
    group = "Satellite",
    options = 
      tileOptions(
        maxZoom = 21,
        maxNativeZoom = 19
      )
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
    options = 
      WMSTileOptions(
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
  here("data/spatial"),
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
  read_rds(
    here("data/field_data.rds")
  ) %>%
  pluck("nests") %>% 
  unnest(interval_data)

# Icons for points:

icons <-
  list.files(
    here("scripts/nest_app/icons"),
    pattern = "png$",
    full.names = TRUE
  ) %>% 
  str_subset("app_icon|nest_old", negate = TRUE) %>% 
  set_names_from_path() %>% 
  imap(
    \ (.icon, .name) {
      
      # Account for the width:height ratio of png files when defining size and
      # position:
      
      if (str_detect(.name, "nest|cam")) {
        make_flexsize_icon(.icon, .modify_height = TRUE)
      } else {
        make_flexsize_icon(.icon)
      }
    }
  ) %>% 
  do.call(iconList, .)

# Simplify path lines:

paths <-
  tracks %>% 
  filter(
    !str_detect(name, "line")
  ) %>% 
  st_simplify(dTolerance = 0.00001, preserveTopology = TRUE)

# nest status --------------------------------------------------------------

# Read and process nest data for map:

nest_proc <-
  nests_start %>% 
  summarize(
    
    # Gather information on what happened during the last sample:
    
    across(
      matches("fate$|^host_[ey]|^date"),
      ~ last(.x),
      .names = "{str_replace(.col, '^host_', 'last_')}"
    ),
    
    # Gather information on the maximum numbers of eggs and young:
    
    across(
      matches("^host_[ey]"),
      ~ max(.x),
      .names = "{str_replace(.col, 'host', 'max')}"
    ),
    .by = 
      c(
        nest_id:discovery_date, 
        height,
        substrate, 
        location_description
      )
  ) %>% 
  mutate(
    
    # Convert NA character values to Unknown:
    
    across(
      where(is.character),
      ~ replace_na(.x, "Unknown")
    ),
    
    # Define a brood status based on what happened during the last check:
    
    brood_status =
      case_when(
        nest_fate == "Success" ~ "Fledged",
        nest_fate == "Failure" & 
          max_young > 0 ~ "Failed: Nestling stage",
        nest_fate == "Failure" &
          max_eggs > 0 ~ "Failed: Egg stage",
        tolower(species) == "artificial" ~ "Artificial",
        last_young > 0 ~ "Nestlings",
        last_eggs > 0 ~ "Eggs",
        .default = "Inactive / Unknown"
      )
  )

# Nests for mapping:

nests_mapping <- 
  
  nest_proc %>% 
  arrange(nest_id) %>% 
  
  # Add nest icons:
  
  mutate(
    icon_id = 
      case_when(
        brood_status %in% c("Fledged", "Nestlings") ~ "nest_active_nestlings",
        brood_status == "Eggs" ~ "nest_active_eggs",
        brood_status == "Failed: Nestling stage" ~ "nest_failed_nestlings",
        brood_status == "Failed: Egg stage" ~ "nest_failed_eggs",
        brood_status == "Artificial" ~ "nest_artificial",
        .default = "nest_inactive"
      )
  ) %>% 

  
  # Add nest spatial data:
  
  left_join(
    select(nests, !icon_id),
    .,
    by = join_by(name == nest_id)
  ) %>% 
  
  # Add nest popup:
  
  left_join(
    nest_proc %>% 
      mutate(
        nest_popup =
          pick(
            everything()
          ) %>%
          make_nest_popup() %>%
          as.character()
      ) %>%
      select(nest_id, nest_popup),
    by = join_by(name == nest_id)
  ) %>% 
  
  # Grab just the columns of interest:
  
  select(name, icon_id:nest_popup)

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
    data = nests_mapping,
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
  appendContent(
    tags$style(
      HTML(
        read_file(
          here("scripts/nest_app/map_styles.css")
        )
      )
    )
  )

# add location tracking ----------------------------------------------------

map_tracking <-
  map_mobile_friendly %>%
  onRender(
    read_file(
      here("scripts/nest_app/map_tracking.js")
    )
  )

# add weather toggle support -----------------------------------------------

# A separate onRender so it runs on desktop too (map_tracking.js returns
# early on non-mobile):

map_tracking <-
  map_tracking %>%
  onRender(
    read_file(here("scripts/nest_app/map_weather.js"))
  )

# embed patch geometries for the patch filter ------------------------------

patch_geo_json <-
  tryCatch(
    {
      pg <- st_transform(patches, 4326)
      
      geoms <-
        seq_len(nrow(pg)) %>%
        map(
          function(i) {
            cc <- 
              st_coordinates(
                st_geometry(pg)[i]
              )
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
      
      jsonlite::toJSON(geoms, auto_unbox = TRUE, digits = NA)
    },
    error = function(e) "{}"
  )

map_tracking <-
  map_tracking %>%
  appendContent(
    tags$script(
      HTML(
        str_c("window.fieldPatches = ", patch_geo_json, ";")
      )
    )
  )

# embed the schedule, keyed by date ----------------------------------------

# Sources schedule_for_map.R and bakes the *whole* upcoming schedule as
# window.fieldSchedule -- a map from date (YYYY-MM-DD) to that day's scheduled
# patches plus the markers to fade. map_weather.js then selects the entry that
# matches the phone's current date, so the map advances to the next day on its
# own. Wrapped so any failure just disables the feature.

field_schedule_json <-
  tryCatch(
    {
      sched_env <- new.env()
      
      source(
        here("scripts/nest_app/schedule_for_map.R"),
        local = sched_env
      )
      
      schedule <- sched_env$schedule
      cam      <- sched_env$next_pred_cam_maintenance
      checks   <- sched_env$next_checks
      
      # "lat,lng" key (6 dp) for every feature in a layer -- matches the keys
      # map_weather.js builds from the marker coordinates.
      
      keyfun <-
        function(sfobj) {
          cc <- st_coordinates(st_transform(sfobj, 4326))
          sprintf("%.6f,%.6f", cc[, "Y"], cc[, "X"])
        }
      
      # Keys of the markers in a layer NOT scheduled on a given day.
      
      fade_keys <-
        function(sfobj, scheduled) {
          keyfun(sfobj)[
            !(as.character(sfobj$name) %in% as.character(scheduled))
          ]
        }
      
      # One day's entry: { patches: [...], fade: { "lat,lng": 0.5 } }. Map
      # markers are named "<patch>_cb_<n>" / "<patch>_trailcam_<n>" (nests by
      # nest_id), so rebuild those names from the schedule to match against.
      
      day_entry <-
        function(d_iso) {
          d <- as_date(d_iso)
          
          sb <- filter(schedule, date == d)
          sc <- filter(cam, date == d)
          
          tp   <- unique(as.character(sb$patch))
          tb   <- unique(str_c(sb$patch, "_cb_", sb$board_id))
          tcam <- unique(str_c(sc$patch, "_trailcam_", sc$camera_id))
          
          tn <-
            checks %>%
            filter(date == d) %>%
            pull(nest_id) %>%
            unique()
          
          not_scheduled <-
            c(
              fade_keys(coverboards, tb),
              fade_keys(nests, tn),
              fade_keys(trailcams, tcam)
            )
          
          list(
            patches = as.list(tp),
            fade =
              not_scheduled %>%
              map(~ 0.5) %>%
              set_names(not_scheduled)
          )
        }
      
      # Every date in the schedule, as YYYY-MM-DD, mapped to its day entry.
      
      all_dates_iso <-
        c(schedule$date, cam$date, checks$date) %>%
        as_date() %>%
        unique() %>%
        sort() %>%
        as.character()
      
      all_dates_iso %>%
        set_names(all_dates_iso) %>%
        map(day_entry) %>%
        jsonlite::toJSON(auto_unbox = TRUE)
    },
    error = function(e) "null"
  )

# Select the day entry matching the phone's CURRENT date (not the render date)
# at page load -- this is what advances the map to the next day on its own. It
# is inline so it runs before field_map_app.js and map_weather.js read
# window.fieldToday.

field_today_selector <-
  '
window.fieldToday = (function () {
  var n = new Date();
  var iso = n.getFullYear() + "-" +
    ("0" + (n.getMonth() + 1)).slice(-2) + "-" +
    ("0" + n.getDate()).slice(-2);
  return (window.fieldSchedule && window.fieldSchedule[iso]) || null;
})();
'

map_tracking <-
  map_tracking %>%
  appendContent(
    tags$script(
      HTML(
        str_c(
          "window.fieldSchedule = ", field_schedule_json, ";\n",
          field_today_selector
        )
      )
    )
  )

# embed offline satellite tiles --------------------------------------------

# Pre-fetch Esri World Imagery tiles

offline_zooms  <- 16:19     # native zooms stored; higher zooms overzoom z19
offline_buffer <- 50        # meters of margin around each patch
tile_cache_dir <- here("scripts/nest_app/offline_tiles")

# Which patches to embed offline imagery:

offline_patches <- 
  c(
    "coyote",
    "witch_hazel",
    "leech",
    "grassland_a"
  )

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
      dir.create(
        tile_cache_dir, 
        showWarnings = FALSE, 
        recursive = TRUE
      )
      
      pg <- st_transform(patches, 4326)
      
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
            bb   <- st_bbox(st_geometry(pg)[i])
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
  appendContent(
    tags$script(
      HTML(
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
          cc <- st_coordinates(st_transform(sfobj, 4326))
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
  appendContent(
    tags$script(
      HTML(
        str_c("window.fieldNavPoints = ", nav_points_json, ";")
      )
    )
  )

icons_json <-
  tryCatch(
    icons %>%
      imap(
        ~ list(
          iconUrl = .x$iconUrl,
          iconWidth = .x$iconWidth,
          iconHeight = .x$iconHeight,
          iconAnchorX = .x$iconAnchorX,
          iconAnchorY = .x$iconAnchorY
        )
      ) %>%
      jsonlite::toJSON(auto_unbox = TRUE),
    error = function(e) "{}"
  )

map_points_json <-
  tryCatch(
    {
      map_points_df <-
        function(sfobj, fallback_icon = NA_character_) {
          cc <- st_coordinates(st_transform(sfobj, 4326))
          ic <-
            if (!is.null(sfobj$icon_id)) {
              as.character(sfobj$icon_id)
            } else {
              fallback_icon
            }
          tibble(
            name = as.character(sfobj$name),
            lat = cc[, "Y"],
            lng = cc[, "X"],
            icon_id = ic
          )
        }

      list(
        map_points_df(nests_mapping),
        map_points_df(coverboards),
        map_points_df(trailcams),
        map_points_df(point_counts, "pc")
      ) %>%
        list_rbind() %>%
        jsonlite::toJSON(dataframe = "rows", digits = NA)
    },
    error = function(e) "[]"
  )

paths_json <-
  tryCatch(
    paths %>%
      st_transform(4326) %>%
      st_geometry() %>%
      map(
        function(.geom) {
          co <- st_coordinates(.geom)
          unname(cbind(co[, "Y"], co[, "X"]))
        }
      ) %>%
      jsonlite::toJSON(digits = NA),
    error = function(e) "[]"
  )

map_tracking <-
  map_tracking %>%
  appendContent(
    tags$script(
      HTML(
        str_c(
          "window.fieldIcons = ", icons_json, ";\n",
          "window.fieldMapPoints = ", map_points_json, ";\n",
          "window.fieldPaths = ", paths_json, ";"
        )
      )
    )
  )

# return the widget --------------------------------------------------------

# field_map.qmd sources this script and prints the `map_tracking` widget to
# render the page, so map_tracking must be the last object left here. Do NOT add
# autopush_updates() or rm(list = ls()) -- this runs inside the Quarto render,
# and dashboard.R pushes to git after the render completes.

map_tracking
