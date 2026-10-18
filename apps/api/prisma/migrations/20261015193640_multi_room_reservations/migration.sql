-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "guest_email" TEXT,
ADD COLUMN     "reservation_group_id" TEXT,
ADD COLUMN     "special_request" TEXT;

-- CreateIndex
CREATE INDEX "bookings_hotel_id_reservation_group_id_idx" ON "bookings"("hotel_id", "reservation_group_id");
