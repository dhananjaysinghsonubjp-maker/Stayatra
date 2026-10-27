-- AlterTable: split users.id_photo_path into front/back (data-preserving — existing value
-- carries into id_photo_front_path, nothing is lost, unlike Prisma's own generated DROP+ADD).
ALTER TABLE "users" ADD COLUMN     "id_photo_back_path" TEXT,
ADD COLUMN     "id_photo_front_path" TEXT;

UPDATE "users" SET "id_photo_front_path" = "id_photo_path" WHERE "id_photo_path" IS NOT NULL;

ALTER TABLE "users" DROP COLUMN "id_photo_path";
