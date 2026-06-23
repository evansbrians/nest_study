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
  
  // No double-crosshairs (caused by multiple onRender fires):
  
  if (map._fieldToolsInit) {
    return;
  }
  map._fieldToolsInit = true;
  
  // Define the mode as field/mobile so that CSS sizing decisions are defined by
  // the above's recognition of the mobile device:
  
  document.documentElement.classList.add("field-mobile");
  document.body.classList.add("field-mobile");
  
  // ... Otherwise, start setting the other variables:
  
  var accuracyCircle = null;
  var headingMarker = null;
  var firstFix = true;
  var latestLatLng = null;
  var orientationBound = false;
  
  // detecting screen orientation angle ------------------------------------
  
  function getScreenAngle() {
    
    // Standard orientation should work on iPhones and Androids and is defined
    // by a screen.orientation.angle of 0 (regular), 90 (rotated sideways
    // counterclockwise), 180 (flipped), and 270 (rotated sideways clockwise) :
    
    if (
      screen.orientation &&
      typeof screen.orientation.angle === "number"
    ) {
      return screen.orientation.angle;
    }
    
    // Older iPhones had a window.orientation number (0, 90, -90, and 180, as
    // above):
    
    if (typeof window.orientation === "number") {
      return window.orientation;
    }
    
    // Sometimes the browser says it's in landscape, but doesn't provide a 
    // number (annoying!). In that case, we'll set the orietation based on
    // the width and height of the window:
    
    if (window.innerWidth > window.innerHeight) {
      return 90;
    }
  
    // Otherwise, we'll assume that the phone is in portrait mode and facing
    // forward, so we don't need to add a correction:
  
    return 0;
  }
  
  // Centering:
  
  function centerOnLatestLocation() {
    if (!latestLatLng) return;
  
    map.invalidateSize(false);
  
    map.setView(
      latestLatLng,
      map.getZoom(),
      {
        animate: false
      }
    );
  }
  
  // Make sure the position of the arrow is still centered on rotation.
  // Rotating phone orientations are a pain!
  
  function refreshMapSizeAndCenter() {
    [100, 300, 600].forEach(function(delay) {
      setTimeout(function() {
        map.invalidateSize(false);
      }, delay);
    });

    // No auto-recenter on GPS: the map defaults to the selected patch and only
    // centers on the user's location when the crosshair button is tapped
    // (which calls centerOnLatestLocation directly).
  }

  window.addEventListener("resize", refreshMapSizeAndCenter);
  window.addEventListener("orientationchange", refreshMapSizeAndCenter);
  
  // accuracy text control -------------------------------------------------

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
  
  // center on location button ---------------------------------------------
  
  var centerControl = L.control({ position: "bottomright" });

  centerControl.onAdd = function(map) {
    var button = L.DomUtil.create(
      "button",
      "leaflet-control center-location-control"
    );
  
    button.type = "button";
    
    // SVG crosshairs:
    
    button.innerHTML =
      '<svg class="center-location-icon" viewBox="0 0 100 100"' +
      ' xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
        '<circle cx="50" cy="50" r="30" fill="none"' +
          ' stroke="#fff" stroke-width="6"/>' +
        '<line x1="50" y1="4" x2="50" y2="96"' +
          ' stroke="#fff" stroke-width="6"/>' +
        '<line x1="4" y1="50" x2="96" y2="50"' +
          ' stroke="#fff" stroke-width="6"/>' +
      '</svg>';
    button.title = "Center on my location";
  
    L.DomEvent.disableClickPropagation(button);
    L.DomEvent.disableScrollPropagation(button);
  
    L.DomEvent.on(button, "click", function(e) {
      L.DomEvent.stop(e);
      
      // Also grants orientation access:
      
      enableOrientation();
  
      if (latestLatLng) {
        centerOnLatestLocation();
      } else if (accuracyDiv) {
        accuracyDiv.innerHTML = "Locating ...";
      }
    });
    
    return button;
  };

  centerControl.addTo(map);
  
  // location tracking ------------------------------------------------------

  map.locate({
    watch: true,
    enableHighAccuracy: true,
    maximumAge: 1000,
    timeout: 15000
  });

  map.on('locationfound', function(e) {
    latestLatLng = e.latlng;
    
    if (firstFix) {
      refreshMapSizeAndCenter();
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

    // The arrow serves as the position marker. It's created on the first GPS
    // fix and repositioned on every subsequent fix. Rotation is handled
    // separately by handleOrientation below.

    if (headingMarker) {
      headingMarker.setLatLng(e.latlng);
    } else {
      headingMarker = L.marker(e.latlng, {
        icon: L.divIcon({
          html: '<svg class="heading-arrow" viewBox="0 0 40 40"' +
            ' width="50" height="50" xmlns="http://www.w3.org/2000/svg">' +
            '<g class="heading-group">' +
              '<polygon points="20,4 34,36 20,27 6,36"' +
                ' fill="#136aec" stroke="white"' +
                ' stroke-width="1.5" stroke-linejoin="round"/>' +
            '</g>' +
          '</svg>',
          className: '',
          iconSize: [50, 50],
          iconAnchor: [25, 25]
        }),
        interactive: false,
        zIndexOffset: 1000
      }).addTo(map);
    }
  });

  map.on('locationerror', function(e) {
    console.warn('Location error: ' + e.message);
  });

  // compass heading --------------------------------------------------------

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
  
  // Convert a device-orientatin event into a true-north heading ... note:
  // - iOS: event.webkitCompassHeading is clockwise heading from true true-north
  // - Android: event.alpha is degrees counter-clockwise from north

  function handleOrientation(event, forceAbsolute) {
    var heading;
  
    if (typeof event.webkitCompassHeading === "number") {
      heading = event.webkitCompassHeading;
    } else if (
      typeof event.alpha === "number" &&
      (forceAbsolute || event.absolute === true)
    ) {
      heading = (360 + event.alpha) % 360;
    } else {
      return;
    }
  
    var correctedHeading =
      (heading - getScreenAngle() + 360) % 360;
  
    setHeading(correctedHeading);
  }
  
  // Device orientation listeners:
  
  function handleAbsolute(e) { handleOrientation(e, true); }
  function handleRelative(e) { handleOrientation(e, false); }

  function removeGestureListeners() {
    document.removeEventListener('touchend', onFirstGesture, true);
    document.removeEventListener('click', onFirstGesture, true);
  }

  function bindOrientation() {
    if (orientationBound) return;
    orientationBound = true;
    removeGestureListeners();
    
    // Android:

    window.addEventListener('deviceorientationabsolute', handleAbsolute, true);
    
    // iPhone:
    
    window.addEventListener('deviceorientation', handleRelative, true);
  }
  
  // iPhones require permission which is triggered by a gesture (Android we are
  // okay without):
  
  function enableOrientation() {
    if (orientationBound) return;

    if (
      typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function'
    ) {
      DeviceOrientationEvent.requestPermission()
        .then(function(result) {
          if (result === 'granted') {
            bindOrientation();
          }
        })
        .catch(function() {});
    } else {
      bindOrientation();
    }
  }

  function onFirstGesture() {
    enableOrientation();
  }

  if (
    typeof DeviceOrientationEvent !== 'undefined' &&
    typeof DeviceOrientationEvent.requestPermission === 'function'
  ) {
    document.addEventListener('touchend', onFirstGesture, true);
    document.addEventListener('click', onFirstGesture, true);
  } else {
    
    // Android / desktop sensors: bind immediately, no gesture needed.
    
    bindOrientation();
  }
}