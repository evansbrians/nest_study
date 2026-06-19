// JavaScript function for adding location and compass bearing to a map

function(el, x) {

  var map = this;
  
  // Check if mobile and get out of here if it isn't!
  
  var isMobile = 
    window.matchMedia("(max-width: 768px)").matches ||
    window.matchMedia("(pointer: coarse)").matches;
  
  if (!isMobile) {
    return;
  }
  
  // ... Otherwise, start setting the other variables:
  
  var accuracyCircle = null;
  var headingMarker = null;
  var firstFix = true;
  var latestLatLng = null;
  
  // detecting screen orientation angle -----------------------------------
  
  function getScreenAngle() {
    if (
      screen.orientation &&
      typeof screen.orientation.angle === "number"
    ) {
      return screen.orientation.angle;
    }
  
    if (typeof window.orientation === "number") {
      return window.orientation;
    }
  
    return 0;
  }
  
  function refreshMapSizeAndCenter() {
    setTimeout(function() {
      map.invalidateSize(false);
  
      if (latestLatLng) {
        map.setView(
          latestLatLng,
          map.getZoom(),
          { animate: false }
        );
      }
    }, 300);
  }

  window.addEventListener("resize", refreshMapSizeAndCenter);
  window.addEventListener("orientationchange", refreshMapSizeAndCenter);
  
  // accuracy text control ------------------------------------------------

  var accuracyControl = L.control({ position: "bottomleft" });
  var accuracyDiv = null;

  accuracyControl.onAdd = function(map) {
    accuracyDiv = L.DomUtil.create(
      "div",
      "leaflet-control location-accuracy-control"
    );

    accuracyDiv.innerHTML = "Accuracy: -- m";
    return accuracyDiv;
  };

  accuracyControl.addTo(map);
  
  // center on location button --------------------------------------------
  
  var centerControl = L.control({ position: "bottomright" });

  centerControl.onAdd = function(map) {
    var button = L.DomUtil.create(
      "button",
      "leaflet-control center-location-control"
    );
  
    button.type = "button";
    button.innerHTML = '<span class="center-location-icon">&#8982;</span>';
    button.title = "Center on my location";
  
    L.DomEvent.disableClickPropagation(button);
    L.DomEvent.disableScrollPropagation(button);
  
    L.DomEvent.on(button, "click", function(e) {
      L.DomEvent.stop(e);
  
      if (latestLatLng) {
        map.invalidateSize(false);
      
        setTimeout(function() {
          map.setView(
            latestLatLng,
            map.getZoom(),
            { animate: false }
          );
        }, 50);
        } else {
          map.locate({
            setView: true,
            enableHighAccuracy: true,
            maxZoom: map.getZoom()
          });
      }
    });
    return button;
  };

  centerControl.addTo(map);

  // location tracking ----------------------------------------------------

  map.locate({
    watch: true,
    enableHighAccuracy: true
  });

  map.on('locationfound', function(e) {
    latestLatLng = e.latlng;
    
    if (firstFix) {
      map.setView(e.latlng, map.getZoom());
      firstFix = false;
    }
    
    // Update accuracy text

    if (accuracyDiv) {
      accuracyDiv.innerHTML =
        "Accuracy: " + Math.round(e.accuracy) + " m";
    }
    
    /* Add an accuracy circle */

    if (accuracyCircle) {
      accuracyCircle.setLatLng(e.latlng).setRadius(e.accuracy);
    } else {
      accuracyCircle = L.circle(e.latlng, {
        radius: e.accuracy,
        color: '#136aec',
        fillColor: '#136aec',
        fillOpacity: 0.15,
        weight: 1,
        interactive: false
      }).addTo(map);
    }

    // The arrow serves as the position marker -- created on the first GPS
    // fix and repositioned on every subsequent fix. Rotation is handled
    // separately by handleOrientation below.

    if (headingMarker) {
      headingMarker.setLatLng(e.latlng);
    } else {
      headingMarker = L.marker(e.latlng, {
        icon: L.divIcon({
          html: '<svg class="heading-arrow" viewBox="0 0 40 40"' +
            ' width="80" height="80" xmlns="http://www.w3.org/2000/svg">' +
            '<g class="heading-group">' +
              '<polygon points="20,4 34,36 20,27 6,36"' +
                ' fill="#136aec" stroke="white"' +
                ' stroke-width="1.5" stroke-linejoin="round"/>' +
            '</g>' +
          '</svg>',
          className: '',
          iconSize: [80, 80],
          iconAnchor: [40, 40]
        }),
        interactive: false,
        zIndexOffset: 1000
      }).addTo(map);
    }
  });

  map.on('locationerror', function(e) {
    console.warn('Location error: ' + e.message);
  });

  // compass heading ------------------------------------------------------

  // Position is managed by locationfound, so setHeading only needs to update
  // the rotation of the existing marker.

  function setHeading(degrees) {
    if (!headingMarker) return;
    var markerEl = headingMarker.getElement();
    if (markerEl) {
      var g = markerEl.querySelector('.heading-group');
      if (g) {
      g.setAttribute('transform', 'rotate(' + degrees + ', 20, 20)');
      }
    }
  }
  
  // This will use the actual orientation if in portrait mode or define based
  // on the direction of the screen if they are not the same.

  function handleOrientation(event) {
    var heading;
  
    if (typeof event.webkitCompassHeading === "number") {
      heading = event.webkitCompassHeading;
    } else if (event.absolute && typeof event.alpha === "number") {
      heading = (360 - event.alpha) % 360;
    } else {
      return;
    }
  
    var correctedHeading =
      (heading - getScreenAngle() + 360) % 360;
  
    setHeading(correctedHeading);
  }

  if (
    typeof DeviceOrientationEvent !== 'undefined' &&
    typeof DeviceOrientationEvent.requestPermission === 'function'
  ) {
    map.once('click', function() {
      DeviceOrientationEvent.requestPermission()
        .then(
          function(result) {
          if (result === 'granted') {
            window.addEventListener(
              'deviceorientation',
              handleOrientation,
              true
              );
            }
          }
        )
        .catch(console.error);
    });
  } else {
    window.addEventListener(
      'deviceorientationabsolute',
      handleOrientation,
      true
    );
    window.addEventListener(
      'deviceorientation',
      handleOrientation,
      true
    );
  }
}