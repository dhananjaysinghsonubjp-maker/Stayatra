-- CreateEnum
CREATE TYPE "StaffApprovalStatus" AS ENUM ('pending', 'approved', 'rejected');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "approval_note" TEXT,
ADD COLUMN     "approval_resolved_at" TIMESTAMP(3),
ADD COLUMN     "approval_resolved_by" TEXT,
ADD COLUMN     "approval_status" "StaffApprovalStatus" NOT NULL DEFAULT 'approved',
ADD COLUMN     "id_number" TEXT,
ADD COLUMN     "id_photo_path" TEXT,
ADD COLUMN     "id_type" "IdType",
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "photo_path" TEXT,
ADD COLUMN     "proposed_by" TEXT;
