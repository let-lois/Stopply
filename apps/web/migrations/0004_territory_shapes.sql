-- Territories become drawn shapes, and get one answer for who works them.
--
-- Two changes, both correcting something that was going to bite.
--
-- 1. A bounding box is not a territory. Real ones follow a street, a canal,
--    one side of a highway. A rectangle around such a shape hands every door
--    on the wrong side of the road to the wrong rep. boundary_json holds the
--    ring the manager actually drew; north/south/east/west stay as a derived
--    box, recomputed from the ring on every write, used to frame the map and
--    to skip territories cheaply. It is an index, never a definition.
--
-- 2. territories.assigned_rep_id and reps.territory_id encoded the same
--    relationship in opposite directions and could disagree. They did not
--    agree by luck: field scoping read reps.territory_id and the territory
--    report read assigned_rep_id, so a rep could be working one territory and
--    reported against another. reps.territory_id survives, because it is the
--    one enforcement uses and because a territory genuinely can have more than
--    one rep on it. The other is gone.

ALTER TABLE territories ADD COLUMN boundary_json TEXT;

-- Backfill: every existing territory becomes the rectangle it already was, so
-- nothing loses its shape and every door keeps its territory.
UPDATE territories
   SET boundary_json = '[[' || west || ',' || south || '],[' ||
                              east || ',' || south || '],[' ||
                              east || ',' || north || '],[' ||
                              west || ',' || north || ']]'
 WHERE boundary_json IS NULL;

-- Carry the old assignment over before dropping it, so nobody's territory is
-- lost in the migration. Only where the rep has none of their own already.
UPDATE reps
   SET territory_id = (
         SELECT t.id FROM territories t
          WHERE t.assigned_rep_id = reps.id AND t.client_id = reps.client_id
          LIMIT 1
       )
 WHERE territory_id IS NULL
   AND EXISTS (SELECT 1 FROM territories t WHERE t.assigned_rep_id = reps.id);

ALTER TABLE territories DROP COLUMN assigned_rep_id;

-- A door belongs to exactly one territory and reporting groups by it, so it is
-- worth an index once a client has more than a couple.
CREATE INDEX IF NOT EXISTS idx_properties_client_territory
  ON properties(client_id, territory_id);
