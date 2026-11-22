-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('advance', 'partial', 'full');

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "cancellation_charge" DECIMAL(10,2),
ADD COLUMN     "end_reason" TEXT;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "type" "PaymentType" NOT NULL DEFAULT 'advance';
