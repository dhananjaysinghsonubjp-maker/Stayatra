-- CreateEnum
CREATE TYPE "IdType" AS ENUM ('aadhaar', 'passport', 'driving_license', 'voter_id', 'other');

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "id_number" TEXT,
ADD COLUMN     "id_type" "IdType";
