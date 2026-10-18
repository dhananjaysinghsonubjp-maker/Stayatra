-- CreateTable
CREATE TABLE "room_blocks" (
    "id" TEXT NOT NULL,
    "hotel_id" TEXT NOT NULL,
    "room_category_id" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "rooms_blocked" INTEGER NOT NULL,
    "reason" TEXT,
    "created_by" TEXT NOT NULL,
    "released_at" TIMESTAMP(3),
    "released_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "room_blocks_hotel_id_room_category_id_start_date_idx" ON "room_blocks"("hotel_id", "room_category_id", "start_date");

-- AddForeignKey
ALTER TABLE "room_blocks" ADD CONSTRAINT "room_blocks_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_blocks" ADD CONSTRAINT "room_blocks_room_category_id_fkey" FOREIGN KEY ("room_category_id") REFERENCES "room_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
