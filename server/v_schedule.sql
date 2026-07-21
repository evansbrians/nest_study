-- v_schedule -----------------------------------------------------------------
-- The served weekly schedule, computed live from the DB instead of materialized
-- by a nightly R job. Ships with the API (installed by deploy.sh, same as
-- v_map_point) so GET /schedule can SELECT from it.
--
-- schedule_day (the base table) holds the season BACKBONE (week, date, day,
-- patch_order, patch_count, boards, arrive, sunrise, times) plus the GUI-OWNED
-- weekly layer Tara edits (helper, field day, search patches, tasks, notes).
-- This view adds the two DERIVED columns on top:
--
--   check_nests      -- the current nests to check on each day's patch, taken
--                       straight from v_current_nest (which already encodes
--                       get_current_nests: fate NULL, last check <= 14 days, and
--                       not "monitored >10 days and always empty"). Always live,
--                       so fledged nests drop and newly-found nests appear with
--                       no rebuild.
--
--   predator_cameras -- which trail-cam (0/1/2) to service on each patch visit.
--                       Faithful port of schedule_camera_maintenance: a camera's
--                       next-due date is its last "counting" maintenance (an
--                       install, or SD + batteries together) + 21 days; keep
--                       cameras due by the end of that visit's week; the two
--                       soonest-due per patch get priority 1 and 2; the patch's
--                       1st and 2nd visits of the week take priority 1 and 2.
--
-- weather is the one non-derivable input (NWS API): a small off-box job
-- (scripts/db/weather_push.R, run daily) POSTs per-date JSON to the `weather`
-- table, which this view joins by date.
--
-- Column list mirrors schedule_day exactly (by name) so GET /schedule's
-- serializer produces the same JSON whether it reads the table or this view.

-- The weather table this view joins. Also created by plumber's boot migration;
-- created here too so installing this file (deploy.sh, before the restart) never
-- races the migration.

CREATE TABLE IF NOT EXISTS weather (
  date     TEXT PRIMARY KEY,
  weather  TEXT
);

DROP VIEW IF EXISTS v_schedule;

CREATE VIEW v_schedule AS
WITH cam AS (
  -- One row per camera: its patch, its number, and its next-due date.
  SELECT
    camera_id,
    substr(camera_id, 1, length(camera_id) - 11) AS patch,     -- strip "_trailcam_N"
    substr(camera_id, -1)                         AS cam_num,   -- the 0/1/2
    date(MAX(event_date), '+21 days')             AS due
  FROM camera_maintenance
  WHERE install = 1 OR (replace_sd = 1 AND replace_batteries = 1)
  GROUP BY camera_id
),
sched AS (
  -- Number each patch's visits within a week by date, and get the week's
  -- Sunday (its last day) as the camera-due cutoff for that week.
  SELECT
    s.*,
    row_number() OVER (
      PARTITION BY s.patch_count, s.week ORDER BY s.date
    ) AS visit,
    date(s.date, 'weekday 0') AS week_sunday
  FROM schedule_day s
),
weeks AS (
  SELECT DISTINCT week, patch_count, week_sunday
  FROM sched
  WHERE patch_count IS NOT NULL
),
cam_rank AS (
  -- Cameras due by each week's Sunday, ranked per patch by soonest-due.
  SELECT
    w.week,
    w.patch_count,
    c.cam_num,
    row_number() OVER (
      PARTITION BY w.week, w.patch_count ORDER BY c.due, c.camera_id
    ) AS priority
  FROM weeks w
  JOIN cam c
    ON c.patch = w.patch_count
   AND c.due  <= w.week_sunday
),
check_n AS (
  -- Current nests per patch, id-sorted, comma-joined.
  SELECT patch_id, group_concat(nest_id, ', ') AS nests
  FROM (SELECT patch_id, nest_id FROM v_current_nest ORDER BY patch_id, nest_id)
  GROUP BY patch_id
)
SELECT
  sched.schedule_day_id,
  sched.week,
  sched.date,
  sched.day,
  sched.helper,
  sched.arrive,
  sched.sunrise,
  sched.patch_order,
  sched.patch_count,
  sched.boards,
  sched.search_patch_1,
  sched.search_patch_2,
  sched.search_patch_3,
  sched.search_patch_4,
  sched.field,
  sched.notes,
  sched.helper_patch_1,
  sched.tns_patch_1,
  sched.helper_patch_2,
  sched.tns_patch_2,
  sched.helper_patch_3,
  sched.tns_patch_3,
  sched.helper_patch_4,
  sched.tns_patch_4,
  cn.nests    AS check_nests,
  cr.cam_num  AS predator_cameras,
  sched.departure_time,
  sched.scbi_departure_time,
  sched.point_count_time,
  w.weather
FROM sched
LEFT JOIN check_n cn
  ON cn.patch_id = sched.patch_count
LEFT JOIN cam_rank cr
  ON cr.week        = sched.week
 AND cr.patch_count = sched.patch_count
 AND cr.priority    = sched.visit
 AND cr.priority   <= 2    -- slice_min(n = 2): only the two soonest-due cameras
LEFT JOIN weather w
  ON w.date = sched.date;
