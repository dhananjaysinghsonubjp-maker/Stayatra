-- CreateEnum
CREATE TYPE "CancellationPolicy" AS ENUM ('free_till_checkin', 'free_24h', 'free_48h', 'free_72h', 'non_refundable');

-- AlterTable
ALTER TABLE "hotels" ADD COLUMN     "allow_unmarried_couples" BOOLEAN,
ADD COLUMN     "cancellation_policy" "CancellationPolicy",
ADD COLUMN     "check_in_time" TEXT,
ADD COLUMN     "check_out_time" TEXT;
