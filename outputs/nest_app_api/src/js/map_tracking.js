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
  var followMode = false;
  var followNeedsZoom = false;
  var centerButtonEl = null;
  var lastHeading = null;

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
  
    // Crosshair tap recenters AND zooms to 19 (close enough to place a nest).

    map.setView(
      latestLatLng,
      19,
      {
        animate: false
      }
    );
  }
  
  // follow mode -------------------------------------------------------------

  // The crosshair button's second job: pin the arrow to the middle of the
  // screen and slide the map underneath it. Blue button = active (same
  // treatment as the padlock); any manual pan hands the view back.

  // Recentring with setView reruns Leaflet's full view reset once a second --
  // every layer repositioned, every tile rebuilt -- which is what made the map
  // teleport instead of glide and left the main thread too busy to keep the
  // compass arrow turning. panTo slides the map pane with a CSS transform
  // instead, and Leaflet still hard-resets on its own once a jump is wider than
  // the screen. The minimum move keeps a standing tech's GPS jitter off screen.

  var FOLLOW_PAN_SECONDS = 1.2;
  var FOLLOW_MIN_MOVE_M = 1;

  function followTo(latlng) {
    var center = map.getCenter();
    if (center && map.distance(center, latlng) < FOLLOW_MIN_MOVE_M) return;

    map.panTo(latlng, {
      duration: FOLLOW_PAN_SECONDS,
      easeLinearity: 1,
      noMoveStart: true
    });
  }

  function applyFollowButton() {
    if (!centerButtonEl) return;
    centerButtonEl.title = followMode
      ? "Stop following my location"
      : "Center on my location";
    centerButtonEl.style.background = followMode ? "#136aecdd" : "";
  }

  // Zoom 19 is applied once, on activation. With no fix yet the zoom is
  // deferred to the first one.

  function startFollow() {
    followMode = true;
    if (latestLatLng) {
      centerOnLatestLocation();
      followNeedsZoom = false;
    } else {
      followNeedsZoom = true;
    }
    applyFollowButton();
  }

  function stopFollow() {
    followMode = false;
    followNeedsZoom = false;
    applyFollowButton();
  }

  function toggleFollow() {
    if (followMode) stopFollow();
    else startFollow();
  }

  // map_weather.js checks this before any automatic re-fit, and field_map_app.js
  // releases follow when the tech deliberately jumps the map to a nest.

  window.fieldFollow = {
    isActive: function() { return followMode; },
    stop: stopFollow
  };

  // Dragging means the tech wants to look somewhere else, so let go. Only user
  // drags fire dragstart -- panTo never does.

  map.on("dragstart", function() {
    if (followMode) stopFollow();
  });

  // Make sure the position of the arrow is still centered on rotation.
  // Rotating phone orientations are a pain!

  function refreshMapSizeAndCenter() {
    [100, 300, 600].forEach(function(delay) {
      setTimeout(function() {
        map.invalidateSize(false);
        if (followMode && latestLatLng) {
          map.setView(latestLatLng, map.getZoom(), { animate: false });
        }
      }, delay);
    });

    // No auto-recenter on GPS unless follow mode is on: the map defaults to the
    // selected patch and otherwise only centers when the crosshair is tapped.
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

      toggleFollow();

      if (followMode && !latestLatLng && accuracyDiv) {
        accuracyDiv.innerHTML = "Locating ...";
      }
    });

    centerButtonEl = button;
    return button;
  };

  centerControl.addTo(map);
  
  // location tracking ------------------------------------------------------

  // The track recorder in field_map_app.js listens on this map's
  // 'locationfound' events, so it depends entirely on the watch started here.
  // If this watch dies, the arrow freezes AND the track silently stops
  // growing. Everything below is written so the watch survives GPS errors and
  // the page being backgrounded (pocketed phone) and can always be restarted.

  var locateOptions = {
    watch: true,
    enableHighAccuracy: true,
    maximumAge: 1000,
    timeout: 15000
  };

  var lastWatchRestart = 0;

  function startWatch() {
    map.locate(locateOptions);
  }

  // Safe to call repeatedly. stopLocate clears the underlying geolocation
  // watch but leaves our 'locationfound' / 'locationerror' handlers (and the
  // track recorder's) attached, so restarting keeps feeding the SAME track.
  // Debounced so a burst of timeouts or visibility flips can't thrash it.

  function restartWatch() {
    var now = Date.now();
    if (now - lastWatchRestart < 3000) return;
    lastWatchRestart = now;
    map.stopLocate();
    startWatch();
  }

  startWatch();

  map.on('locationfound', function(e) {
    latestLatLng = e.latlng;
    
    if (firstFix) {
      refreshMapSizeAndCenter();
      firstFix = false;
    }

    // Follow mode: hold the arrow at the centre and move the map instead.

    if (followMode) {
      if (followNeedsZoom) {
        centerOnLatestLocation();
        followNeedsZoom = false;
      } else {
        followTo(e.latlng);
      }
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

      applyHeading();
    }
  });

  map.on('locationerror', function(e) {
    console.warn('Location error: ' + e.message);

    // A transient GPS error (timeout / position-unavailable) must NOT end an
    // in-progress track. Only an explicit Stop (user action, in
    // field_map_app.js) does that. A suspended watch sometimes keeps firing
    // errors without recovering, so we restart it; the same track keeps
    // recording because the 'locationfound' handlers stay attached.
    // code 1 = permission denied, where restarting cannot help.

    if (e.code === 1) return;
    restartWatch();
  });

  // keep-alive: wake lock + resume -----------------------------------------

  // The tech pockets the phone mid-walk and needs the track to keep going. A
  // screen wake lock keeps the page alive (screen on) while a track records.
  // The lock is dropped automatically whenever the page is hidden, so it has
  // to be re-requested on return. A wake lock keeps the SCREEN on but cannot
  // run JS with the screen truly off (the browser suspends us), so on resume
  // we also restart the geolocation watch so fixes keep flowing into the SAME
  // track (no new track is started here).

  var wakeLock = null;

  // Track state lives in field_map_app.js; we stay decoupled by reading the
  // record button's label ("Stop track" only while recording).

  function trackIsRecording() {
    var btn = document.getElementById("trackToggleBtn");
    return !!btn && /Stop/.test(btn.textContent || "");
  }

  function requestWakeLock() {
    if (!("wakeLock" in navigator) || wakeLock || document.hidden) return;
    navigator.wakeLock.request("screen")
      .then(function(lock) {
        wakeLock = lock;
        lock.addEventListener("release", function() { wakeLock = null; });
      })
      .catch(function() { wakeLock = null; });
  }

  function releaseWakeLock() {
    if (!wakeLock) return;
    try { wakeLock.release(); } catch (err) {}
    wakeLock = null;
  }

  function syncWakeLock() {
    if (trackIsRecording()) requestWakeLock();
    else releaseWakeLock();
  }

  document.addEventListener("visibilitychange", function() {
    if (document.hidden) return;

    // Back in the foreground: re-acquire the dropped wake lock and, if a track
    // was recording, restart the watch so it resumes on the SAME track.

    requestWakeLock();
    if (trackIsRecording()) restartWatch();
  });

  // The record button lives in field_map_app.js. field_map_app.js flips its
  // label inside its own click handler, so we read the settled state on the
  // next tick (order-independent) and match the wake lock to it.

  var trackToggleBtn = document.getElementById("trackToggleBtn");
  if (trackToggleBtn) {
    trackToggleBtn.addEventListener("click", function() {
      setTimeout(syncWakeLock, 0);
    });
  }

  // lock-screen toggle -----------------------------------------------------

  // A one-tap map lock for crawling through cover. The padlock starts OPEN; a
  // tap closes it and freezes the map exactly where it is. While locked the map
  // stays fully visible, but a transparent shield over the whole screen swallows
  // every tap/pan/zoom so the view can't be nudged -- only the padlock itself
  // stays live, and tapping it again unlocks. Belt-and-suspenders, Leaflet's own
  // interaction handlers are disabled too (covers hardware keyboards / trackpads).

  var mapLocked = false;
  var lockBlocker = null;
  var lockButtonEl = null;
  var lockBtnHome = null;   // where the padlock lives in the Leaflet control

  // Open padlock: shackle up, right leg lifted off the body (unlocked look).
  var LOCK_ICON_OPEN =
    '<svg class="lock-screen-icon" viewBox="0 0 100 100"' +
    ' xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      '<rect x="24" y="44" width="52" height="40" rx="6"' +
        ' fill="none" stroke="#fff" stroke-width="6"/>' +
      '<path d="M34 44 V32 a16 16 0 0 1 32 0"' +
        ' fill="none" stroke="#fff" stroke-width="6"/>' +
    '</svg>';

  // Closed padlock: both shackle legs meet the body (locked look).
  var LOCK_ICON_CLOSED =
    '<svg class="lock-screen-icon" viewBox="0 0 100 100"' +
    ' xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      '<rect x="24" y="44" width="52" height="40" rx="6"' +
        ' fill="none" stroke="#fff" stroke-width="6"/>' +
      '<path d="M34 44 V32 a16 16 0 0 1 32 0 V44"' +
        ' fill="none" stroke="#fff" stroke-width="6"/>' +
    '</svg>';

  // The transparent shield. It captures every interaction so nothing beneath it
  // (map, markers, controls, the app menu bar) responds -- the padlock button is
  // lifted above it so it alone stays tappable.
  function buildLockBlocker() {
    if (lockBlocker) return lockBlocker;
    var b = document.createElement("div");
    b.className = "field-lock-blocker";
    b.style.cssText =
      "position:fixed;top:0;left:0;right:0;bottom:0;z-index:100000;" +
      "background:transparent;touch-action:none;" +
      "-webkit-user-select:none;user-select:none;";
    ["click", "dblclick", "touchstart", "touchmove", "touchend",
      "pointerdown", "pointermove", "pointerup", "mousedown", "mousemove",
      "wheel", "contextmenu"].forEach(function(t) {
      b.addEventListener(t, function(e) {
        if (e.cancelable) e.preventDefault();
        e.stopPropagation();
      }, { passive: false });
    });
    document.body.appendChild(b);
    lockBlocker = b;
    return b;
  }

  function setMapInteractions(enabled) {
    ["dragging", "touchZoom", "doubleClickZoom", "scrollWheelZoom",
      "boxZoom", "keyboard", "tap"].forEach(function(h) {
      if (map[h]) {
        try { enabled ? map[h].enable() : map[h].disable(); } catch (e) {}
      }
    });
  }

  function applyLockButton() {
    if (!lockButtonEl) return;
    lockButtonEl.innerHTML = mapLocked ? LOCK_ICON_CLOSED : LOCK_ICON_OPEN;
    lockButtonEl.title = mapLocked ? "Unlock screen" : "Lock screen";
    // Lift the padlock above the shield + tint it while active.
    lockButtonEl.style.zIndex = mapLocked ? "100001" : "";
    lockButtonEl.style.background = mapLocked ? "#136aecdd" : "";
  }

  function lockMap() {
    mapLocked = true;
    buildLockBlocker().style.display = "block";
    setMapInteractions(false);
    // The padlock sits in Leaflet's control container, whose own stacking
    // context (z-index 1000) would trap it beneath the shield. Lift it to the
    // body so it alone stays above the shield and tappable. Same CSS class ->
    // same on-screen spot.
    if (lockButtonEl && lockButtonEl.parentNode !== document.body) {
      lockBtnHome = { parent: lockButtonEl.parentNode, next: lockButtonEl.nextSibling };
      document.body.appendChild(lockButtonEl);
    }
    applyLockButton();
  }

  function unlockMap() {
    mapLocked = false;
    if (lockBlocker) lockBlocker.style.display = "none";
    setMapInteractions(true);
    applyLockButton();
    // Return the padlock to its Leaflet control slot.
    if (lockButtonEl && lockBtnHome) {
      if (lockBtnHome.next && lockBtnHome.next.parentNode === lockBtnHome.parent) {
        lockBtnHome.parent.insertBefore(lockButtonEl, lockBtnHome.next);
      } else {
        lockBtnHome.parent.appendChild(lockButtonEl);
      }
      lockBtnHome = null;
    }
  }

  function toggleMapLock() { if (mapLocked) unlockMap(); else lockMap(); }

  var lockControl = L.control({ position: "bottomright" });

  lockControl.onAdd = function(map) {
    var button = L.DomUtil.create(
      "button",
      "leaflet-control lock-screen-control"
    );

    button.type = "button";
    button.title = "Lock screen";
    button.innerHTML = LOCK_ICON_OPEN;

    L.DomEvent.disableClickPropagation(button);
    L.DomEvent.disableScrollPropagation(button);

    L.DomEvent.on(button, "click", function(e) {
      L.DomEvent.stop(e);
      toggleMapLock();
    });

    lockButtonEl = button;
    return button;
  };

  lockControl.addTo(map);

  // compass heading --------------------------------------------------------

  // Position is managed by locationfound, so setHeading only needs to update
  // the rotation of the existing marker.

  // The heading is remembered so it can be re-applied whenever the marker's
  // element is rebuilt (a view reset does that) -- otherwise the arrow quietly
  // stops turning until the next compass event happens to land on a live
  // element.

  function setHeading(degrees) {
    lastHeading = degrees;
    applyHeading();
  }

  function applyHeading() {
    if (lastHeading === null || !headingMarker) return;

    var markerEl = headingMarker.getElement();
    if (!markerEl) return;

    var g = markerEl.querySelector('.heading-group');
    if (g) {
      g.setAttribute('transform', 'rotate(' + lastHeading + ', 20, 20)');
    }
  }

  map.on("moveend zoomend", applyHeading);
  
  // Site magnetic declination (NOAA, Front Royal VA, ~2026): true = magnetic +
  // declination. West declination is negative. Update annually (~0.1 deg/yr) or
  // if the study moves. A constant is fine across a single study area.
  var FIELD_MAG_DECLINATION = -10.07;

  // Convert a device-orientation event into a TRUE-north heading. Both sources
  // below are referenced to MAGNETIC north:
  //   - iOS: event.webkitCompassHeading (clockwise from magnetic north)
  //   - Android: event.alpha (counter-clockwise from magnetic north)
  // so we add the site declination to match the iPhone Compass and our maps.

  function handleOrientation(event, forceAbsolute) {
    var heading;

    if (typeof event.webkitCompassHeading === "number") {
      heading = event.webkitCompassHeading;
    } else if (
      typeof event.alpha === "number" &&
      (forceAbsolute || event.absolute === true)
    ) {
      heading = (360 - event.alpha) % 360;
    } else {
      return;
    }

    heading = (heading + FIELD_MAG_DECLINATION + 360) % 360;   // magnetic -> true

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