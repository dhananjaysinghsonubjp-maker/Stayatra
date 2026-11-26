-- CreateEnum
CREATE TYPE "RateChangeStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "RateModificationRule" AS ENUM ('set', 'increase', 'decrease');

-- CreateTable
CREATE TABLE "rate_change_requests" (
    "id" TEXT NOT NULL,
    "hotel_id" TEXT NOT NULL,
    "room_category_ids" TEXT[],
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "days_of_week" INTEGER[],
    "modification_rule" "RateModificationRule" NOT NULL,
    "value" DECIMAL(10,2) NOT NULL,
    "discount_percent" DECIMAL(5,2),
    "remarks" TEXT,
    "status" "RateChangeStatus" NOT NULL DEFAULT 'pending',
    "requested_by_user_id" TEXT NOT NULL,
    "decided_by_user_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rate_change_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rate_change_requests_hotel_id_status_idx" ON "rate_change_requests"("hotel_id", "status");

-- AddForeignKey
ALTER TABLE "rate_change_requests" ADD CONSTRAINT "rate_change_requests_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
