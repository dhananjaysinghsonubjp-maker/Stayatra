-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('male', 'female', 'other', 'prefer_not_to_say');

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "guest_id" TEXT,
ADD COLUMN     "purpose_of_stay" TEXT;

-- CreateTable
CREATE TABLE "guests" (
    "id" TEXT NOT NULL,
    "hotel_id" TEXT NOT NULL,
    "title" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "gender" "Gender",
    "date_of_birth" DATE,
    "address" TEXT,
    "country" TEXT DEFAULT 'India',
    "state" TEXT,
    "city" TEXT,
    "pincode" TEXT,
    "id_type" "IdType",
    "id_number" TEXT,
    "id_photo_path" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "guests_hotel_id_phone_idx" ON "guests"("hotel_id", "phone");

-- AddForeignKey
ALTER TABLE "guests" ADD CONSTRAINT "guests_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_guest_id_fkey" FOREIGN KEY ("guest_id") REFERENCES "guests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
