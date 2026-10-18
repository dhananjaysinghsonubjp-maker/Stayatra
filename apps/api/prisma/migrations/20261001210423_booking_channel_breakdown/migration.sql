-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "channel_breakdown" JSONB,
ADD COLUMN     "ota_cancellation_policy" TEXT;
