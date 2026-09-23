-- AlterEnum
ALTER TYPE "AuditEventType" ADD VALUE 'DELAY_RESOLVED';

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "assigned_room_id" TEXT;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_assigned_room_id_fkey" FOREIGN KEY ("assigned_room_id") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;
