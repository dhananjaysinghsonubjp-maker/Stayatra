-- AlterTable
ALTER TABLE "hotels" ADD COLUMN     "amenities" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "bank_account_holder_name" TEXT,
ADD COLUMN     "bank_account_number" TEXT,
ADD COLUMN     "bank_ifsc" TEXT,
ADD COLUMN     "pan_number" TEXT;

-- CreateTable
CREATE TABLE "hotel_photos" (
    "id" TEXT NOT NULL,
    "hotel_id" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hotel_photos_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "hotel_photos" ADD CONSTRAINT "hotel_photos_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
