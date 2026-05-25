// JavaScript function for adding location and compass bearing icon to a map

function(el, x) {
  
  // 'this' inside onRender refers to the live leaflet map object:

  var map = this;
  
  // Assign position marker and accuracy circle and compass bearing to objects:

  var positionMarker = null;
  var accuracyCircle = null;
  var headingMarker = null;
  
  // Track whether this is the first GPS fix so we can pan your location
  // on load without re-centering every time you move.
      
  var firstFix = true;

  // location tracking ----------------------------------------------------
  
  // Start watching your position.
  // * `watch: true` keeps the listener running continuously rather than
  //    running just once. 
  // * `enableHighAccuracy` requests GPS on devices that have it

  map.locate({
    watch: true,
    enableHighAccuracy: true
  });
  
  // `locationfound` runs each time a new position is available:

  map.on('locationfound', function(e) {
    
    // Pan to your location on the first fix only. After that, the map stays
    // wherever you scrolled so you can look around without it going back to
    // your location:
        
    if (firstFix) {
      map.setView(
        e.latlng, 
        map.getZoom()
      );
      firstFix = false;
    }
    
    // `e.accuracy` is the GPS uncertainty circle in meters. This will
    // update if the circle already exists and creates it otherwise:

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

    // `L.circleMarker` stays a fixed pixel size on screen regardless of
    // zoom:
        
    if (positionMarker) {
      positionMarker.setLatLng(e.latlng);
    } else {
      positionMarker = L.circleMarker(e.latlng, {
        radius: 9,
        color: '#ffffff',
        fillColor: '#136aec',
        fillOpacity: 1,
        weight: 2,
        interactive: false
      }).addTo(map);
    }

    if (headingMarker) {
      headingMarker.setLatLng(e.latlng);
    }
  });
  
  // `locationerror` happens if the browser denies permission or your phone
  // has no location signal.

  map.on('locationerror', function(e) {
    console.warn('Location error: ' + e.message);
  });

  // compass heading ------------------------------------------------------

  // Heading is displayed with a rotating arrow:
      
  function setHeading(latlng, degrees) {
    if (!headingMarker) {
      headingMarker = L.marker(latlng, {
        icon: L.divIcon({
  
          // Create an SVG arrow and wrap it inside of a rotating div:
  
          html: '<div class="heading-arrow" style="width:40px; height:40px;">' +
                  '<svg viewBox="0 0 40 40" width="40" height="40"' +
                  ' xmlns="http://www.w3.org/2000/svg">' +
                  '<polygon points="20,2 28,20 20,15 12,20"' +
                  ' fill="#136aec" stroke="white"' +
                  ' stroke-width="1.5" stroke-linejoin="round"/>' +
                  '</svg>' +
                '</div>',
          className:  '',
          iconSize:   [40, 40],
          iconAnchor: [20, 20]
        }),
        interactive:  false,
        zIndexOffset: 0
      }).addTo(map);
    } else {
      headingMarker.setLatLng(latlng);
    }
  
    var markerEl = headingMarker.getElement();
    if (markerEl) {
      var arrow = markerEl.querySelector('.heading-arrow');
      if (arrow) {
        arrow.style.transform = 'rotate(' + degrees + 'deg)';
      }
    }
}
  
  // Orientation supplied by iOS or Android. webkitCompassHeading (iOS) 
  // gives degrees clockwise from magnetic North directly. Android, 
  // annoyingly, provides its orientation using deviceorientationabsolute 
  // with alpha measured counterclockwise from the east, which needs 
  // to then be converted to a compass bearing.

  function handleOrientation(event) {
    var heading;
    if (typeof event.webkitCompassHeading === 'number') {
      heading = event.webkitCompassHeading;
    } else if (event.absolute && typeof event.alpha === 'number') {
      heading = (360 - event.alpha) % 360;
    } else {
      return;
    }
    if (positionMarker) {
      setHeading(positionMarker.getLatLng(), heading);
    }
  }
  
  // iOS blocks DeviceOrientationEvent until a user grants permission from
  // a gesture. A tap on a map control qualifies, so a compass button
  // is added. On Android the event fires immediately without any prompt.

  // iOS blocks DeviceOrientationEvent until a user grants permission from
  // a gesture. A tap on a map control qualifies, so a compass button
  // is added. On Android the event fires immediately without any prompt.

  if (
    typeof DeviceOrientationEvent !== 'undefined' &&
    typeof DeviceOrientationEvent.requestPermission === 'function'
  ) {
    var compassControl = L.control({ position: 'bottomright' });  // moved from topright
    compassControl.onAdd = function() {
      var div = L.DomUtil.create('div', 'leaflet-bar');
      div.innerHTML =
        '<a href="#" title="Enable compass"' +
        ' style="font-size:20px; line-height:34px; display:block;' +
        ' width:34px; text-align:center; text-decoration:none;">&#x1F9ED;</a>';
      L.DomEvent.on(div, 'click', function(e) {
        L.DomEvent.preventDefault(e);
        DeviceOrientationEvent.requestPermission()
          .then(function(result) {
            if (result === 'granted') {
              window.addEventListener('deviceorientation', handleOrientation, true);
              div.remove();
            }
          })
          .catch(console.error);
      });
      return div;
    };
    compassControl.addTo(map);
  } else {
    window.addEventListener('deviceorientationabsolute', handleOrientation, true);
    window.addEventListener('deviceorientation',         handleOrientation, true);
  }
}