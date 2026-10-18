-- AlterTable
ALTER TABLE "room_categories" ADD COLUMN     "amenities" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "bathroom_count" INTEGER,
ADD COLUMN     "bed_type" TEXT,
ADD COLUMN     "max_occupancy" INTEGER,
ADD COLUMN     "room_size_sqft" INTEGER,
ADD COLUMN     "room_type" TEXT,
ADD COLUMN     "room_view" TEXT;

-- CreateTable
CREATE TABLE "room_photos" (
    "id" TEXT NOT NULL,
    "room_category_id" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_photos_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "room_photos" ADD CONSTRAINT "room_photos_room_category_id_fkey" FOREIGN KEY ("room_category_id") REFERENCES "room_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
