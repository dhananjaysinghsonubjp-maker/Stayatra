-- AlterTable
ALTER TABLE "room_categories" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "description" TEXT;
