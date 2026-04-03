
# Source script for various spatial data processing operations

# Author: Brian Evans
# Created on: 2026-04-01
# Last modified: 2026-04-01

# my version of list.files() ----------------------------------------------

# Allows more flexible regex and produces a named list!

list_files <-
  function(
    .file_path = ".",
    .extension = ".",
    .regex_keep = ".*",
    .regex_avoid = "helloworld"
  ) {
    # List the file in the read directory:
    
    fs::dir_ls(
      .file_path,
      regexp = str_c(.extension, "$")
    ) %>% 
      
      # Keep or avoid strings:
      
      keep(
        ~ str_detect(
          .x,
          str_c(
            str_c(
              "^(?!.*",
              .regex_avoid, 
              ")"
            ),
            str_c(
              ".*",
              .regex_keep
            )
          )
        )
      ) %>% 
      
      # Set the names to use for the list items:
      
      set_names(
        fs::path_file(.) %>% 
          fs::path_ext_remove()
      )
  }

# basic map for checking plot edits ---------------------------------------

make_map <-
  function(
    .patch_layer = patches,
    .coverboards = TRUE,
    .coyote_line = FALSE
  ) {
    out_map <-
      leaflet() %>% 
      
      # Add background layer with a deep zoom:
      
      addProviderTiles(
        "Esri.WorldImagery",
        options = providerTileOptions(maxZoom = 21)
      ) %>% 
      
      # Add the polygons:
      
      addPolygons(
        data = .patch_layer,
        group = "patches",
        fillColor = "#eee",
        fillOpacity = 0.5,
        popup = ~name
      ) 
    
    # Add GPS points for coverboards:
    
    if(.coverboards) {
      out_map <-
        out_map %>% 
        leaflet::addCircles(
          data = coverboards,
          radius = 3,
          weight = 1,
          opacity = 1,
          fillOpacity = 1,
          fillColor = "#ff0",
          color = "#000"
        )
    }
    
    # Add GPS points for coyote_line:
    
    if(.coyote_line) {
      out_map <-
        out_map %>% 
        leaflet::addCircles(
          data = coyote_line,
          radius = 3,
          weight = 1,
          opacity = 1,
          fillOpacity = 1,
          fillColor = "#ff0",
          color = "#000"
        )
    }
    out_map
  }

# area calculator ---------------------------------------------------------

# You can/should ignore me, I'm written in JavaScript:

add_area_display <- 
  function(
    map,
    target_ha = 1, 
    position = "bottomright"
  ) {
    
    htmlwidgets::onRender(
      map,
      sprintf("
      function(el, x) {
        var map = this;
        var targetHa = %f;

        var script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/@turf/turf@6/turf.min.js';
        document.head.appendChild(script);

        var areaControl = L.control({ position: '%s' });

        areaControl.onAdd = function() {
          this._div = L.DomUtil.create('div');
          this._div.style.cssText = [
            'background: white',
            'padding: 8px 14px',
            'border-radius: 5px',
            'border: 1px solid #aaa',
            'font-size: 14px',
            'font-family: Arial, sans-serif',
            'min-width: 160px',
            'text-align: center'
          ].join(';');
          this._div.innerHTML = '<i>Edit a polygon<br>to see its area</i>';
          return this._div;
        };

        areaControl.addTo(map);

        function updateDisplay(ha) {
          var diff = Math.abs(ha - targetHa);
          var pct  = ((ha / targetHa) * 100).toFixed(1);
          var m2   = Math.round(ha * 10000);
          var bg   = diff < 0.05 ? '#c8f5c8' : diff < 0.15
          ? '#fff3b0' : '#ffc8c8';

          areaControl._div.style.background = bg;
          areaControl._div.innerHTML =
            '<b>' + ha.toFixed(4) + ' ha</b>' +
            '<br>' + m2.toLocaleString() + ' m\\u00B2' +
            '<br><span style=\"font-size:12px;color:#555\">' +
            pct + '%% of ' + targetHa + ' ha target</span>';
        }

        map.on('draw:editvertex', function(e) {
          if (typeof turf === 'undefined' || !e.poly) return;
          var area = turf.area(e.poly.toGeoJSON());
          updateDisplay(area / 10000);
        });

        map.on('draw:edited', function(e) {
          if (typeof turf === 'undefined') return;
          e.layers.eachLayer(function(layer) {
            var area = turf.area(layer.toGeoJSON());
            updateDisplay(area / 10000);
          });
        });

        map.on('draw:editstop', function() {
          areaControl._div.style.background = 'white';
          areaControl._div.innerHTML = 
          '<i>Edit a polygon<br>to see its area</i>';
        });
      }
    ", target_ha, position)
    )
  }

# edit patches ------------------------------------------------------------

edit_patches <-
  function(
    .patches = patches_edited
  ) {
    
    # Target a patch and use my function for mapping:
    
    edited_layer <-  
      .patches %>% 
      make_map() %>%  
      
      # Add the editing toolbar:
      
      addDrawToolbar(
        targetGroup = "patches",
        
        # We don't want the options for drawing new shapes:
        
        polylineOptions = FALSE,
        polygonOptions = FALSE,
        circleOptions = FALSE,
        rectangleOptions = FALSE,
        markerOptions = FALSE,
        circleMarkerOptions = FALSE,
        
        # We do want editing options:
        
        editOptions = editToolbarOptions()
      ) %>% 
      
      # Add the area display:
      
      add_area_display() %>% 
      
      # Get returns for the edited content:
      
      mapedit::editMap() %>% 
      pluck("all")
    
    edited_layer %>% 
      mutate(
        name = .patches$name
      ) %>% 
      select(name)
  }
