-- Airport = a pickup territory marked «это аэропорт» (operator 2026-11-25); the fixed 2.5 km circle is gone.
ALTER TABLE "NoGoZone" ADD COLUMN "airport" TEXT;

-- Keep today's behaviour where possible: an active pickup territory that contains the terminal point is marked
-- as that airport. Polygons are stored as [[lat, lng], …] — both sides of the check use (lat, lng).
UPDATE "NoGoZone" z SET "airport" = a.code
FROM (VALUES ('LCA', 34.8751::float8, 33.6249::float8), ('PFO', 34.718::float8, 32.4857::float8)) AS a(code, lat, lng)
WHERE z."kind" = 'POINT' AND z."active" = true AND z."airport" IS NULL
  AND jsonb_typeof(z."polygon") = 'array' AND jsonb_array_length(z."polygon") >= 3
  AND (
    SELECT ('(' || string_agg('(' || (e->>0) || ',' || (e->>1) || ')', ',' ORDER BY i) || ')')::polygon
    FROM jsonb_array_elements(z."polygon") WITH ORDINALITY AS t(e, i)
  ) @> point(a.lat, a.lng);
