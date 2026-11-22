-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "BookingStatus" ADD VALUE 'no_show';
ALTER TYPE "BookingStatus" ADD VALUE 'void';

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "expected_arrival_time" TEXT,
ADD COLUMN     "expected_departure_time" TEXT,
ADD COLUMN     "id_photo_back_path" TEXT,
ADD COLUMN     "id_photo_front_path" TEXT,
ADD COLUMN     "internal_notes" TEXT,
ADD COLUMN     "is_vip" BOOLEAN NOT NULL DEFAULT false;
