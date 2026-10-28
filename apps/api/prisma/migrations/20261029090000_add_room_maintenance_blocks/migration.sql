-- CreateTable
CREATE TABLE "room_maintenance_blocks" (
    "id" TEXT NOT NULL,
    "hotel_id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "start_at" TIMESTAMP(3) NOT NULL,
    "end_at" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "created_by" TEXT NOT NULL,
    "released_at" TIMESTAMP(3),
    "released_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_maintenance_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "room_maintenance_blocks_hotel_id_room_id_start_at_idx" ON "room_maintenance_blocks"("hotel_id", "room_id", "start_at");

-- AddForeignKey
ALTER TABLE "room_maintenance_blocks" ADD CONSTRAINT "room_maintenance_blocks_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_maintenance_blocks" ADD CONSTRAINT "room_maintenance_blocks_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
