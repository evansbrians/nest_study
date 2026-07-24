-- v_map_point --------------------------------------------------------------
--
-- ONE row per map marker, with everything the map needs to draw it:
--   idx, name, class, lat, lng, ref_id, status, icon, opacity, size
--
-- Why: a point's appearance was previously derived in four places that had to
-- agree (make_field_map.R's bake, map_weather.js, nestapi_map.js, and the
-- client's buildTodayFade). They drifted, and every marker bug we chased came
-- from that. This view is the single source of truth; the map becomes a dumb
-- renderer, and a data problem is now visible with a plain SELECT.
--
-- Install (safe on the live DB -- it's just a view):
--   sudo -u nestapi sqlite3 /opt/nest-api/server/nest_study.sqlite < v_map_point.sql
--
-- Inspect:
--   SELECT class, status, opacity, COUNT(*) FROM v_map_point GROUP BY 1,2,3;
--   SELECT * FROM v_map_point WHERE class='coverboard' ORDER BY name;
--
-- "Today" = the server's local date, advancing to the NEXT scheduled field day
-- when today isn't one (mirrors make_field_map.R, so the map never blanks on a
-- non-field day). Field work is daytime, so a UTC-configured server still lands
-- on the right date; if that ever bites, change date('now','localtime') below.
-- ---------------------------------------------------------------------------

DROP VIEW IF EXISTS v_map_point;

CREATE VIEW v_map_point AS
WITH RECURSIVE

-- The day the map is showing: today if it's a field day, else the next one.
target AS (
  SELECT MIN(date) AS d
  FROM schedule_day
  WHERE UPPER(COALESCE(field, '')) = 'TRUE'
    AND date >= date('now', 'localtime')
),

-- That day's schedule rows. boards / check_nests / predator_cameras are
-- comma-separated TEXT, so they get split below.
day_rows AS (
  SELECT TRIM(COALESCE(s.patch_count, ''))      AS patch,
         COALESCE(s.boards, '')                 AS boards
  FROM schedule_day s
  JOIN target t ON s.date = t.d
  WHERE UPPER(COALESCE(s.field, '')) = 'TRUE'
),

-- ---- split the comma-separated schedule cells into tokens -----------------

board_split(patch, rest, tok) AS (
  SELECT patch, boards || ',', '' FROM day_rows
  UNION ALL
  SELECT patch,
         SUBSTR(rest, INSTR(rest, ',') + 1),
         TRIM(SUBSTR(rest, 1, INSTR(rest, ',') - 1))
  FROM board_split WHERE rest <> ''
),
-- gps_point.point_name of every board due today ("<patch>_cb_<n>")
sched_board AS (
  SELECT DISTINCT patch || '_cb_' || tok AS point_name
  FROM board_split
  WHERE tok NOT IN ('', '-') AND patch NOT IN ('', '-')
),

-- trailcam camera_ids due today ("<patch>_trailcam_<n>"), read from v_schedule
-- -- the live schedule, where each camera's 21-day due date decides which one a
-- visit services. Parsing the stored schedule_day.predator_cameras here made it
-- go stale as maintenance events shifted those due dates.
sched_cam AS (
  SELECT DISTINCT vs.patch_count || '_trailcam_' || vs.predator_cameras AS camera_id
  FROM v_schedule vs
  JOIN target t ON vs.date = t.d
  WHERE vs.predator_cameras IS NOT NULL
    AND vs.predator_cameras <> ''
    AND UPPER(COALESCE(vs.field, '')) = 'TRUE'
),

-- nest_ids due today, derived LIVE exactly like v_schedule's check_nests: a
-- current nest is due today when its patch is one of today's scheduled patches.
-- Parsing the stored schedule_day.check_nests text here made this go stale --
-- newly found nests (e.g. N139) stayed faded until the schedule was re-pushed.
sched_nest AS (
  SELECT DISTINCT v.nest_id
  FROM v_current_nest v
  WHERE v.patch_id IN (SELECT patch FROM day_rows WHERE patch NOT IN ('', '-'))
),

-- ---- nest display state ---------------------------------------------------

nest_agg AS (
  SELECT nest_id,
         MAX(host_eggs)  AS max_eggs,
         MAX(host_young) AS max_young
  FROM interval_check
  GROUP BY nest_id
),

-- "Box elder, Spicebush" -- the plant species the popup lists.
nest_subs AS (
  SELECT ns.nest_id, GROUP_CONCAT(s.label, ', ') AS substrates
  FROM nest_substrate ns
  JOIN substrate s ON s.substrate_id = ns.substrate_id
  GROUP BY ns.nest_id
),

nest_disp AS (
  SELECT
    n.nest_id,
    n.gps_point_id,
    n.discovery_date,
    n.nest_fate,
    n.artificial_candidate,

    -- Popup facts. The DB states them; the client renders the markup (SQL is
    -- the wrong place for buttons/photo slots, but the right place for facts).
    COALESCE(sp.common_name, n.species_other, 'Unknown') AS species,
    n.patch_id                    AS nest_patch,
    n.height_m,
    n.location_description,
    sb.substrates,
    lc.check_date                 AS last_check,
    COALESCE(lc.host_eggs, 0)     AS last_eggs,
    COALESCE(lc.host_young, 0)    AS last_young,

    -- concluded = has a recorded fate (Success / Failure / Unknown)
    CASE WHEN n.nest_fate IS NOT NULL THEN 1 ELSE 0 END AS concluded,
    CASE WHEN cn.nest_id IS NOT NULL THEN 1 ELSE 0 END  AS in_current_view,
    CASE
      WHEN n.nest_fate = 'Success' THEN 'Fledged'
      WHEN n.nest_fate = 'Failure' AND COALESCE(ag.max_young, 0) > 0
        THEN 'Failed: Nestling stage'
      WHEN n.nest_fate = 'Failure' AND COALESCE(ag.max_eggs, 0) > 0
        THEN 'Failed: Egg stage'
      WHEN COALESCE(sp.is_artificial, 0) = 1 THEN 'Artificial'
      WHEN COALESCE(lc.host_young, 0) > 0 THEN 'Nestlings'
      WHEN COALESCE(lc.host_eggs, 0)  > 0 THEN 'Eggs'
      ELSE 'Inactive / Unknown'
    END AS brood_status
  FROM nest n
  LEFT JOIN species             sp ON sp.species_code = n.species_code
  LEFT JOIN v_nest_latest_check lc ON lc.nest_id      = n.nest_id
  LEFT JOIN nest_agg            ag ON ag.nest_id      = n.nest_id
  LEFT JOIN v_current_nest      cn ON cn.nest_id      = n.nest_id
  LEFT JOIN nest_subs           sb ON sb.nest_id      = n.nest_id
),

nest_final AS (
  SELECT d.*,
    -- current: not concluded, AND (in v_current_nest OR still holding eggs/young
    -- OR artificial). Mirrors make_field_map.R's `current`.
    CASE WHEN d.concluded = 0
           AND (d.in_current_view = 1
                OR d.brood_status IN ('Eggs', 'Nestlings', 'Artificial')
                OR d.nest_id LIKE 'NQ%')
         THEN 1 ELSE 0 END AS is_current,
    CASE
      WHEN d.nest_id LIKE 'NQ%' AND d.nest_fate = 'Failure'
                                              THEN 'nest_failed_artificial'
      WHEN d.nest_id LIKE 'NQ%'               THEN 'nest_artificial'
      WHEN d.brood_status IN ('Fledged', 'Nestlings')
                                              THEN 'nest_active_nestlings'
      WHEN d.brood_status = 'Eggs'            THEN 'nest_active_eggs'
      WHEN d.brood_status = 'Failed: Nestling stage'
                                              THEN 'nest_failed_nestlings'
      WHEN d.brood_status = 'Failed: Egg stage'
                                              THEN 'nest_failed_eggs'
      WHEN d.brood_status = 'Artificial'      THEN 'nest_artificial'
      ELSE 'nest_inactive'
    END AS icon
  FROM nest_disp d
),

-- An NQ nest and its host N twin share one gps_point, so a point can resolve to
-- two nests. Pick ONE: artificial wins, then current, then newest discovery --
-- the same precedence as nestapi_map.js pickDisplayForPoint().
nest_pick AS (
  SELECT * FROM (
    SELECT nf.*,
      ROW_NUMBER() OVER (
        PARTITION BY nf.gps_point_id
        ORDER BY CASE WHEN nf.nest_id LIKE 'NQ%' THEN 0 ELSE 1 END,
                 CASE WHEN nf.is_current = 1     THEN 0 ELSE 1 END,
                 COALESCE(nf.discovery_date, '') DESC
      ) AS rn
    FROM nest_final nf
    WHERE nf.gps_point_id IS NOT NULL
  )
  WHERE rn = 1
),

-- ---- is this marker on today's list? --------------------------------------

flagged AS (
  SELECT
    g.point_id, g.point_name, g.point_class, g.latitude, g.longitude,
    g.note,
    np.nest_id, np.icon AS nest_icon, np.brood_status, np.is_current,
    np.artificial_candidate,
    np.species, np.nest_patch, np.height_m, np.location_description,
    np.substrates, np.discovery_date, np.last_check, np.last_eggs, np.last_young,
    pc.camera_id, COALESCE(np.nest_patch, pc.patch_id) AS patch,
    CASE
      WHEN g.point_class = 'coverboard' THEN
        CASE WHEN g.point_name IN (SELECT point_name FROM sched_board)
             THEN 1 ELSE 0 END
      WHEN g.point_class = 'trailcam' THEN
        CASE WHEN pc.camera_id IN (SELECT camera_id FROM sched_cam)
             THEN 1 ELSE 0 END
      WHEN g.point_class = 'nest' THEN
        -- artificial nests are never faded by the today filter (as in the R)
        CASE WHEN np.nest_id IN (SELECT nest_id FROM sched_nest)
                  OR np.nest_id LIKE 'NQ%'
             THEN 1 ELSE 0 END
      ELSE 1   -- landmarks / point counts / other are never today-faded
    END AS scheduled_today
  FROM gps_point g
  LEFT JOIN nest_pick       np ON np.gps_point_id = g.point_id
  LEFT JOIN predator_camera pc ON pc.gps_point_id = g.point_id
)

SELECT
  point_id                       AS idx,
  point_name                     AS name,
  point_class                    AS class,
  latitude                       AS lat,
  longitude                      AS lng,
  COALESCE(nest_id, camera_id)   AS ref_id,

  CASE
    WHEN point_class = 'nest' THEN COALESCE(brood_status, 'Inactive / Unknown')
    WHEN scheduled_today = 1  THEN 'Scheduled today'
    ELSE 'Not scheduled'
  END                            AS status,

  -- The REAL icon_id, i.e. a key into window.fieldIcons (the icons/ png stems),
  -- so the map can do fieldIcons[icon] directly. Coverboards and trailcams are
  -- numbered per board/camera -- cb_1..cb_6, cam_0..cam_2 -- parsed out of the
  -- point_name ("<patch>_cb_<n>" / "<patch>_trailcam_<n>"). Emitting the bare
  -- class here ("coverboard") was wrong: there is no coverboard.png, and
  -- renderMapPoints() SKIPS any point whose icon_id misses fieldIcons.
  CASE
    WHEN point_class = 'nest' THEN COALESCE(nest_icon, 'nest_inactive')
    WHEN point_class = 'coverboard' AND INSTR(point_name, '_cb_') > 0
      THEN 'cb_' || SUBSTR(point_name, INSTR(point_name, '_cb_') + 4)
    WHEN point_class = 'trailcam' AND INSTR(point_name, '_trailcam_') > 0
      THEN 'cam_' || SUBSTR(point_name, INSTR(point_name, '_trailcam_') + 10)
    WHEN point_class = 'point_count' THEN 'pc'
    -- Landmarks have no custom png: 'marker' means Leaflet's built-in
    -- marker-icon.png, which the renderer falls back to for any icon_id that
    -- doesn't resolve in fieldIcons.
    WHEN point_class = 'landmark' THEN 'marker'
    ELSE NULL
  END                            AS icon,

  -- The two fades are exposed SEPARATELY as well as combined, because the app
  -- applies them independently: the non-current fade always, the today fade only
  -- while "Subset to today's data" is on. Collapsing them into `opacity` alone
  -- would make that toggle unable to distinguish them.
  CASE WHEN point_class = 'nest' THEN COALESCE(is_current, 0) ELSE 1 END
                                 AS is_current,
  scheduled_today                AS scheduled_today,

  -- Two independent 0.5 fades, combined as the client's Math.min did: a nest is
  -- full opacity only when it is BOTH current AND on today's list; infra points
  -- only when scheduled today.
  CASE
    WHEN point_class = 'nest'
      THEN CASE WHEN COALESCE(is_current, 0) = 1 AND scheduled_today = 1
                THEN 1.0 ELSE 0.5 END
    WHEN point_class IN ('coverboard', 'trailcam')
      THEN CASE WHEN scheduled_today = 1 THEN 1.0 ELSE 0.5 END
    ELSE 1.0
  END                            AS opacity,

  -- Current nests render 15% larger (make_field_map.R nest_big_json).
  CASE WHEN point_class = 'nest' AND COALESCE(is_current, 0) = 1
       THEN 1.15 ELSE 1.0 END    AS size,

  -- ---- popup facts (NULL for non-nest classes, whose popup is just the name)
  patch,
  species,
  substrates,
  height_m,
  location_description,
  discovery_date,

  -- 1 only for natural nests flagged as artificial-nest candidates; 0 otherwise
  -- (including non-nest classes). Drives the "Map options" candidates-only filter.
  CASE WHEN point_class = 'nest' THEN COALESCE(artificial_candidate, 0) ELSE 0 END
                                 AS artificial_candidate,

  last_check,
  last_eggs,
  last_young,
  note

FROM flagged;
