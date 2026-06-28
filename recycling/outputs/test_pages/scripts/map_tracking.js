// JavaScript function for adding location and compass bearing to a map

function(el, x) {

  var map = this;
  var accuracyCircle = null;
  var headingMarker = null;
  var firstFix = true;
  // var maxAllowedAccuracy = 100;

  // location tracking ----------------------------------------------------

  
  
  map.locate({
    watch: true,
    enableHighAccuracy: true,
    
    /* Haven't gotten this to work yet:
    
    maximumAge: 0,
    timeout: 15000
    
      */
  });


  map.on('locationfound', function(e) {
    
    // If the browser reports a low accuracy fix, don't move the marker -- this
    // should ensure that the marker will not be placed far away:
    
    /* Haven't gotten this to work yet:
    
    if (e.accuracy > maxAllowedAccuracy) {
      console.warn(
        'Ignoring low-accuracy location fix: ' + 
        Math.round(e.accuracy) + ' m'
      );

    return;
    }
    
    */
    
    if (firstFix) {
      map.setView(e.latlng, map.getZoom());
      firstFix = false;
    }

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

  // compass heading ------------------------------------------------------

  // Position is now managed by locationfound, so setHeading only needs
  // to update the rotation of the existing marker.

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

  function handleOrientation(event) {
    var heading;
    if (typeof event.webkitCompassHeading === 'number') {
      heading = event.webkitCompassHeading;
    } else if (event.absolute && typeof event.alpha === 'number') {
      heading = (360 - event.alpha) % 360;
    } else {
      return;
    }
    setHeading(heading);
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