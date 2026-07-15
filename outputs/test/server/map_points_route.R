# /map_points route -- append to /opt/nest-api/server/plumber.R, then restart.
#
#   sudo cp /opt/nest-api/server/plumber.R /opt/nest-api/server/plumber.R.bak-$(date +%F)
#   sudo tee -a /opt/nest-api/server/plumber.R < map_points_route.R > /dev/null
#   sudo systemctl restart nest-api
#
# Uses the same global `con` the other routes use, and sits behind the same auth
# filter, so it needs no special handling. Backed by the v_map_point view: the DB
# decides how every marker renders (icon / opacity / size / status), instead of
# the client re-deriving it. Install v_map_point.sql first.

#* One row per map marker, carrying everything needed to draw it:
#* idx, name, class, lat, lng, ref_id, status, icon, opacity, size.
#* Optional ?class= filters to a single point class (nest / coverboard /
#* trailcam / point_count / landmark / other), mirroring /gps_points?class=.
#* Opacity/size reflect TODAY's schedule (advancing to the next field day when
#* today isn't one) -- see v_map_point.sql.
#* @get /map_points
#* @serializer unboxedJSON
function(req, res, class = NULL) {
  if (is.null(class) || !nzchar(class)) {
    dbGetQuery(con, "SELECT * FROM v_map_point")
  } else {
    dbGetQuery(
      con,
      "SELECT * FROM v_map_point WHERE class = ?",
      params = list(class)
    )
  }
}
