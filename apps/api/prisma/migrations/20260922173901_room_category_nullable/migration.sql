-- DropForeignKey
ALTER TABLE "rooms" DROP CONSTRAINT "rooms_room_category_id_fkey";

-- AlterTable
ALTER TABLE "rooms" ALTER COLUMN "room_category_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_room_category_id_fkey" FOREIGN KEY ("room_category_id") REFERENCES "room_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
