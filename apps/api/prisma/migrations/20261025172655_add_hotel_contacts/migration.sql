-- CreateTable
CREATE TABLE "hotel_contacts" (
    "id" TEXT NOT NULL,
    "hotel_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hotel_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "hotel_contacts_hotel_id_idx" ON "hotel_contacts"("hotel_id");

-- AddForeignKey
ALTER TABLE "hotel_contacts" ADD CONSTRAINT "hotel_contacts_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
