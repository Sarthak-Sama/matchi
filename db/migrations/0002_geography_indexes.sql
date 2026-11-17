-- Expression GiST indexes supporting the `ST_DWithin(col::geography,
-- other::geography, meters)` idiom the Task 7 `derive` script uses for
-- genuine-metres distance filtering (amenity counts, land-price points).
--
-- A GiST index built on a `geometry` column (e.g. `pois_point_gist_idx`
-- from 0001_init.sql) is NOT used by the query planner when the column is
-- cast to `geography` inside the predicate -- PostgreSQL only matches an
-- index against a query expression that is structurally identical to the
-- indexed expression, and `point` and `point::geography` are different
-- expressions. This was verified empirically (see task-7-report.md): even
-- with `SET enable_seqscan = off`, Postgres could not produce an index
-- scan on `pois` for `ST_DWithin(point::geography, ..., 800)` without an
-- index on the cast expression itself. These expression indexes fix that.

CREATE INDEX pois_point_geog_gist_idx ON pois USING gist ((point::geography));
CREATE INDEX land_prices_point_geog_gist_idx ON land_prices USING gist ((point::geography));
