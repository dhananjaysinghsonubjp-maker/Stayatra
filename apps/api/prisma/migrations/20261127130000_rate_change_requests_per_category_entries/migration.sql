-- AlterTable: add the new per-category `entries` column first (nullable), backfill from the old
-- flat room_category_ids[] + single value, then drop the old columns.
ALTER TABLE "rate_change_requests" ADD COLUMN "entries" JSONB;

UPDATE "rate_change_requests"
SET "entries" = COALESCE(
  (
    SELECT jsonb_agg(jsonb_build_object('roomCategoryId', cat_id, 'value', "value", 'availability', NULL))
    FROM unnest("room_category_ids") AS cat_id
  ),
  '[]'::jsonb
)
WHERE "entries" IS NULL;

ALTER TABLE "rate_change_requests" ALTER COLUMN "entries" SET NOT NULL;

ALTER TABLE "rate_change_requests" DROP COLUMN "room_category_ids";
ALTER TABLE "rate_change_requests" DROP COLUMN "value";
