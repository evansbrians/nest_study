var APP_POINT_DATA_ID = "1JE63Iy4_hLRfaHjENlBHDpLYPKgD33B6";
var SHARED_SECRET = "23_boy_howdy_58";

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);

    if (data.secret !== SHARED_SECRET) {
      return reply({ ok: false, error: "bad secret" });
    }

    var study = clean(data.study);
    var target = clean(data.target);
    var kind = clean(data.kind);
    var filename = String(data.filename || "waypoints.geojson")
      .replace(/[^A-Za-z0-9_.\-]/g, "_");

    if (study !== "oxbow" && study !== "scbi") {
      return reply({ ok: false, error: "unknown study" });
    }
    if (target !== "individual_points" &&
        target !== "bundled_points" &&
        target !== "tracks" &&
        target !== "concealment_photos" &&
        target !== "concealment_meta") {
      return reply({ ok: false, error: "unknown target" });
    }

    var root = DriveApp.getFolderById(APP_POINT_DATA_ID);
    var folder = childFolder(childFolder(root, study), target);

    if (kind === "image") {
      var bytes = Utilities.base64Decode(String(data.data || ""));
      folder.createFile(Utilities.newBlob(bytes, mimeFromName(filename), filename));
    } else if (kind === "json") {
      folder.createFile(filename, String(data.data || ""), "application/json");
    } else {
      folder.createFile(filename, String(data.geojson || ""), "application/geo+json");
    }

    return reply({ ok: true, filename: filename });
  } catch (err) {
    return reply({ ok: false, error: String(err) });
  }
}

function doGet(e) {
  return reply({ ok: true, msg: "relay is live" });
}

function clean(s) {
  return String(s == null ? "" : s).replace(/[^A-Za-z0-9_]/g, "");
}

function childFolder(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function mimeFromName(name) {
  var n = String(name).toLowerCase();
  if (n.match(/\.png$/))  return "image/png";
  if (n.match(/\.webp$/)) return "image/webp";
  if (n.match(/\.heic$/)) return "image/heic";
  return "image/jpeg";
}

function reply(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
