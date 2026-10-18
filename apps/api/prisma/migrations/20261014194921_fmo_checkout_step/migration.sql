-- AlterEnum
ALTER TYPE "AuditEventType" ADD VALUE 'CHECK_OUT';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'cleaning_discrepancy';

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "checked_out_at" TIMESTAMP(3),
ADD COLUMN     "checked_out_by" TEXT;
