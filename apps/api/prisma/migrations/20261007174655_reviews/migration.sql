-- CreateTable
CREATE TABLE "reviews" (
    "id" TEXT NOT NULL,
    "hotel_id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "source" "BookingSource" NOT NULL,
    "rating" DECIMAL(3,1) NOT NULL,
    "max_rating" INTEGER NOT NULL DEFAULT 10,
    "review_text" TEXT,
    "review_date" DATE NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reviews_hotel_id_review_date_idx" ON "reviews"("hotel_id", "review_date");

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
