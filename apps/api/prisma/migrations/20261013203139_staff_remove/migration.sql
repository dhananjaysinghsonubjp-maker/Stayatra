-- AlterEnum
ALTER TYPE "AuditEventType" ADD VALUE 'STAFF_REMOVED';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true;
