-- CreateEnum
CREATE TYPE "MessageSender" AS ENUM ('guest', 'staff');

-- CreateTable
CREATE TABLE "guest_messages" (
    "id" TEXT NOT NULL,
    "hotel_id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "sender" "MessageSender" NOT NULL,
    "body" TEXT NOT NULL,
    "read_by_staff" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guest_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "guest_messages_hotel_id_booking_id_idx" ON "guest_messages"("hotel_id", "booking_id");

-- CreateIndex
CREATE INDEX "guest_messages_hotel_id_created_at_idx" ON "guest_messages"("hotel_id", "created_at");

-- AddForeignKey
ALTER TABLE "guest_messages" ADD CONSTRAINT "guest_messages_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_messages" ADD CONSTRAINT "guest_messages_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
