-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditEventType" ADD VALUE 'RATE_BULK_UPDATE';
ALTER TYPE "AuditEventType" ADD VALUE 'RATE_VALUE_OVERRIDE';
ALTER TYPE "AuditEventType" ADD VALUE 'RESTRICTION_UPDATED';
ALTER TYPE "AuditEventType" ADD VALUE 'ROOM_MAPPING_UPDATED';
ALTER TYPE "AuditEventType" ADD VALUE 'CREDENTIALS_UPDATED';
ALTER TYPE "AuditEventType" ADD VALUE 'CHANNEL_CONNECTED';
