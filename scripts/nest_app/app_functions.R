
# This file is meant to simplify the script a little bit to make it easier to
# find issues.

# functions for make_field_map.R ------------------------------------------

# Function to define icon sizes:

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
      magick::image_read(.icon_url) %>% 
      magick::image_info()
      
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
          <li><strong>Patch</strong>: {patch_id}</li>
          <li><strong>Plant species</strong>: {substrate}</li>
          <li><strong>Height</strong>: {height}</li>
          <li><strong>Location description</strong>: {location_description}</li>
          <li><strong>Discovered on</strong>: {discovery_date}</li>
          <li><strong>Last checked on</strong>: {date}</li>
          <li><strong>Current status</strong>: {brood_status}</li>
          <li><strong>N eggs (last check)</strong>: {last_eggs}</li>
          <li><strong>N young (last check)</strong>: {last_young}</li>
        </ul>
      </div>
      "
    )
  }

