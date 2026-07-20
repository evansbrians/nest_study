-- Restore full-precision coordinates truncated to 4 dp by the 2026-07-03
-- migration. Values recovered from data/spatial/nest_locations.geojson git
-- history (best precision ever recorded per point); rounded to 7 dp (~11 mm).
-- Keyed on point_id. A shared N/NQ point is corrected once, fixing both.
-- N116 is NOT here: it was never recorded above 4 dp -> field re-record.
-- Generated 2026-07-20. 18 points.

BEGIN;
UPDATE gps_point SET latitude = 38.895156, longitude = -78.164157 WHERE point_id = '67cbbd72-c9f5-4c77-aa41-a29b5edc176e';  -- N013 (was 4dp; git 5fc765e)
UPDATE gps_point SET latitude = 38.89303, longitude = -78.156319 WHERE point_id = '08147f50-5da6-4a96-aab6-34e449131aed';  -- N017 (was 4dp; git 5fc765e)
UPDATE gps_point SET latitude = 38.892737, longitude = -78.171709 WHERE point_id = '94741914-901c-4f69-8055-89520c1b022a';  -- N018 (was 4dp; git 5fc765e)
UPDATE gps_point SET latitude = 38.889596, longitude = -78.163931 WHERE point_id = '2dd660ef-001a-47ad-a4b3-ab6e9c273ec3';  -- N023 (was 4dp; git 5fc765e)
UPDATE gps_point SET latitude = 38.894075, longitude = -78.166862 WHERE point_id = '376d8224-d1f4-4fea-8327-d7f1b41e8d16';  -- N037 (was 4dp; git 8e50ce7)
UPDATE gps_point SET latitude = 38.89406, longitude = -78.166783 WHERE point_id = '35b3d2cd-63bf-4bf0-9dfe-b58b38446462';  -- N038 (was 4dp; git 8e50ce7)
UPDATE gps_point SET latitude = 38.89286, longitude = -78.170772 WHERE point_id = 'a22b0a28-c9fa-42d0-a74e-52b06dd88118';  -- N040 (was 4dp; git 5fc765e)
UPDATE gps_point SET latitude = 38.890888, longitude = -78.158828 WHERE point_id = '7ebca9f6-7b73-47c1-8a7b-3935f683f972';  -- N042 (was 4dp; git 5fc765e)
UPDATE gps_point SET latitude = 38.893443, longitude = -78.156476 WHERE point_id = '63c3ece3-5474-4aaa-b4d6-96001139a65a';  -- N043 (was 4dp; git d2e8bdc)
UPDATE gps_point SET latitude = 38.889395, longitude = -78.163557 WHERE point_id = 'd45bd9fc-5b19-4458-b817-3f785c4e61e1';  -- N055 (was 4dp; git d2e8bdc)
UPDATE gps_point SET latitude = 38.889354, longitude = -78.163475 WHERE point_id = 'f6180fd9-7005-412f-9aa0-85539fdfa77d';  -- N056 (was 4dp; git 5fc765e)
UPDATE gps_point SET latitude = 38.898072, longitude = -78.151643 WHERE point_id = 'c1e9dce7-7c32-4d49-8fd9-0fa5289c0890';  -- N059 (was 4dp; git 8e50ce7)
UPDATE gps_point SET latitude = 38.898214, longitude = -78.151405 WHERE point_id = '005d1b98-c2f5-4cf2-a9cc-79baed25000f';  -- N060 (was 4dp; git 8e50ce7)
UPDATE gps_point SET latitude = 38.898226, longitude = -78.151257 WHERE point_id = 'e9bf8473-143f-46e8-af54-7d761fbe1586';  -- N061 (was 4dp; git 8e50ce7)
UPDATE gps_point SET latitude = 38.897728, longitude = -78.150653 WHERE point_id = '25a62df1-3d1a-4bc0-8858-b0c410d676f6';  -- N062 (was 4dp; git 8e50ce7)
UPDATE gps_point SET latitude = 38.8913222, longitude = -78.1601194 WHERE point_id = '9fe6fbe5-4e45-4127-b463-a9e1912452c5';  -- N084 (was 4dp; git 8e50ce7)
UPDATE gps_point SET latitude = 38.8947247, longitude = -78.1653502 WHERE point_id = '6a96f476-02d1-4edd-946b-51b351653789';  -- N089 (was 4dp; git 8e50ce7)
UPDATE gps_point SET latitude = 38.8912179, longitude = -78.1597571 WHERE point_id = 'a4e82d7e-4110-4e34-9a4f-db577690b2d4';  -- N107 (was 4dp; git 882c2df)
COMMIT;
