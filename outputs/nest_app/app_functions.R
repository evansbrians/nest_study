
# This file is meant to simplify the script a little bit to make it easier to
# find issues.

# functions for make_field_map.R ------------------------------------------

# Function to define icon sizes:

png_dimensions <-
  function(.file) {
    con <- file(.file, "rb")
    on.exit(close(con))
    readBin(con, "raw", n = 16)
    list(
      width = readBin(con, "integer", n = 1, size = 4, endian = "big"),
      height = readBin(con, "integer", n = 1, size = 4, endian = "big")
    )
  }

make_flexsize_icon <-
  function(
    .icon_url,               # Path to the png file        
    .icon_width = 20.25,     # The width of the leaflet icon
    .icon_height = 20.25,    # The height of the leaflet icon
    .anchor_offset_x = 0.5,  # Horizontal anchor offset (default = middle)
    .anchor_offset_y = 0.5,  # Vertical anchor offset (default = middle)
    .modify_width = FALSE,   # Whether to modify the width
    .modify_height = FALSE,  # Whether to modify the height,
    ...                      # Other arguments passed to `leaflet::makeIcon()`
    ) {
    
    image_info <-
      png_dimensions(.icon_url)
      
      # Add a modifier for width:height, if chosen:
      
      if (.modify_width) {
        .icon_width <- .icon_width * image_info$width / image_info$height
      }
      
      # Add a modifier for height:width, if chosen:
      
      if (.modify_height) {
        .icon_height <- .icon_width * image_info$height / image_info$width
      }
      
      makeIcon(
        iconUrl = 
          base64enc::dataURI(
            file = .icon_url, 
            mime = "image/png"
          ),
        iconWidth = .icon_width,
        iconHeight = .icon_height,
        iconAnchorX = .icon_height * .anchor_offset_x,
        iconAnchorY = .icon_height * .anchor_offset_y,
        ...
      )
    }

# Function to make popup:

make_nest_popup <-
  function(.x) {
    glue_data(
      .x,
      "
      <div style='font-family: Times;'>
        <h3><strong>{nest_id}</strong>. Species: {species}</h3>
        <ul>
          <li><strong>Patch</strong>: {pretty_patch(patch_id)}</li>
          <li><strong>Plant species</strong>: {substrate}</li>
          <li><strong>Height</strong>: {height}</li>
          <li><strong>Location description</strong>: {location_description}</li>
          <li><strong>Discovered on</strong>: {discovery_date}</li>
          <li><strong>Last checked on</strong>: {date}</li>
          <li><strong>Current status</strong>: {brood_status}</li>
          <li><strong>N eggs (last check)</strong>: {last_eggs}</li>
          <li><strong>N young (last check)</strong>: {last_young}</li>
        </ul>
        <button type='button' class='field-popup-btn' onclick='window.fieldModifyNavPoint(\"{nest_id}\")'>Modify</button>
      </div>
      "
    )
  }

# Patch names are snake_case in the data; display them in sentence case
# (spaces, not underscores) wherever shown -- never alters the data.

pretty_patch <-
  function(.x) {
    .x %>%
      str_replace_all("_", " ") %>%
      str_to_sentence()
  }
