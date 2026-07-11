  // Image annotator: show a captured photo full-screen and let the user mark
  // (freehand-draw, e.g. circle) the nest location before it is saved. Touch +
  // mouse. Returns the flattened annotated image as a JPEG data URL.
  //
  //   window.fieldAnnotatePhoto(dataUrl, function (result, meta) { ... });
  //
  // The callback fires once: on Done with the flattened annotated image
  // (meta.annotated === true), on Skip with the original dataUrl unchanged
  // (meta.annotated === false). The whole UI is built on the fly and removed
  // when it closes, so no host-page markup is required.

  window.fieldAnnotatePhoto = function (dataUrl, cb) {
    if (!dataUrl) { if (cb) cb(dataUrl, { annotated: false }); return; }

    var img = new Image();
    img.onload = function () { buildAnnotator(img, dataUrl, cb); };
    img.onerror = function () { if (cb) cb(dataUrl, { annotated: false }); };
    img.src = dataUrl;
  };

  function buildAnnotator(img, dataUrl, cb) {
    var done = false;
    function finish(result, annotated) {
      if (done) return;
      done = true;
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if (cb) cb(result, { annotated: !!annotated });
    }

    // Full-screen host. Inline styles so no frozen-CSS dependency.
    var overlay = document.createElement("div");
    overlay.className = "field-annotate-overlay";
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:100000;display:flex;flex-direction:column;" +
      "background:rgba(0,0,0,0.92);touch-action:none;";

    var hint = document.createElement("div");
    hint.textContent = "Draw a circle around the nest, then tap Done.";
    hint.style.cssText =
      "flex:0 0 auto;color:#fff;font:600 1rem/1.3 sans-serif;text-align:center;" +
      "padding:10px 12px;";

    var stage = document.createElement("div");
    stage.style.cssText =
      "flex:1 1 auto;display:flex;align-items:center;justify-content:center;" +
      "overflow:hidden;min-height:0;";

    // Canvas at native image resolution; CSS scales it to fit the stage.
    var canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    canvas.style.cssText =
      "max-width:100%;max-height:100%;touch-action:none;display:block;" +
      "border-radius:6px;";
    var ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    // Red stroke scaled to the image so it reads on high-res photos.
    var lineW = Math.max(3, Math.round(Math.max(canvas.width, canvas.height) / 180));
    ctx.strokeStyle = "#ff2d2d";
    ctx.lineWidth = lineW;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    var drawing = false, hasMark = false, lastX = 0, lastY = 0;

    function toCanvas(clientX, clientY) {
      var r = canvas.getBoundingClientRect();
      return {
        x: (clientX - r.left) * (canvas.width / r.width),
        y: (clientY - r.top) * (canvas.height / r.height)
      };
    }
    function start(clientX, clientY) {
      var p = toCanvas(clientX, clientY);
      drawing = true; hasMark = true; lastX = p.x; lastY = p.y;
      ctx.beginPath(); ctx.moveTo(p.x, p.y);
      // A dot so a single tap still leaves a mark.
      ctx.lineTo(p.x + 0.01, p.y + 0.01); ctx.stroke();
    }
    function move(clientX, clientY) {
      if (!drawing) return;
      var p = toCanvas(clientX, clientY);
      ctx.beginPath(); ctx.moveTo(lastX, lastY); ctx.lineTo(p.x, p.y); ctx.stroke();
      lastX = p.x; lastY = p.y;
    }
    function end() { drawing = false; }

    canvas.addEventListener("mousedown", function (e) { e.preventDefault(); start(e.clientX, e.clientY); });
    canvas.addEventListener("mousemove", function (e) { if (drawing) { e.preventDefault(); move(e.clientX, e.clientY); } });
    window.addEventListener("mouseup", end);
    canvas.addEventListener("touchstart", function (e) {
      if (!e.touches.length) return;
      e.preventDefault(); start(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: false });
    canvas.addEventListener("touchmove", function (e) {
      if (!e.touches.length) return;
      e.preventDefault(); move(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: false });
    canvas.addEventListener("touchend", function (e) { e.preventDefault(); end(); }, { passive: false });

    stage.appendChild(canvas);

    // Button bar.
    var bar = document.createElement("div");
    bar.style.cssText =
      "flex:0 0 auto;display:flex;gap:10px;justify-content:center;padding:12px;";
    function mkBtn(label, bg) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.style.cssText =
        "flex:1 1 0;max-width:180px;padding:14px 10px;border:none;border-radius:8px;" +
        "font:600 1.05rem sans-serif;color:#fff;background:" + bg + ";";
      return b;
    }
    var clearBtn = mkBtn("Clear", "#555");
    var skipBtn = mkBtn("Skip", "#8a6d1f");
    var doneBtn = mkBtn("Done", "#1f7a37");

    clearBtn.addEventListener("click", function () {
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = "#ff2d2d"; ctx.lineWidth = lineW;
      ctx.lineJoin = "round"; ctx.lineCap = "round";
      hasMark = false;
    });
    skipBtn.addEventListener("click", function () { finish(dataUrl, false); });
    doneBtn.addEventListener("click", function () {
      // Flatten to a data URL. Fall back to the original if canvas export fails
      // (e.g. memory limits on very large images).
      var out = null;
      try { out = canvas.toDataURL("image/jpeg", 0.85); } catch (e) { out = null; }
      finish(out || dataUrl, hasMark && !!out);
    });

    bar.appendChild(clearBtn);
    bar.appendChild(skipBtn);
    bar.appendChild(doneBtn);

    overlay.appendChild(hint);
    overlay.appendChild(stage);
    overlay.appendChild(bar);
    document.body.appendChild(overlay);
  }
