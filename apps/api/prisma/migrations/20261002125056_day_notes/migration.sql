-- CreateTable
CREATE TABLE "day_notes" (
    "id" TEXT NOT NULL,
    "hotel_id" TEXT NOT NULL,
    "room_category_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "note" TEXT NOT NULL,
    "updated_by" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "day_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "day_notes_room_category_id_date_key" ON "day_notes"("room_category_id", "date");

-- AddForeignKey
ALTER TABLE "day_notes" ADD CONSTRAINT "day_notes_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "day_notes" ADD CONSTRAINT "day_notes_room_category_id_fkey" FOREIGN KEY ("room_category_id") REFERENCES "room_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
