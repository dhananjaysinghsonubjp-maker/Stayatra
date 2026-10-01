-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('sync_failed', 'booking_created', 'booking_cancelled');

-- CreateTable
CREATE TABLE "ota_credentials" (
    "id" TEXT NOT NULL,
    "ota_connection_id" TEXT NOT NULL,
    "cipher_text" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "auth_tag" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ota_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "hotel_id" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ota_credentials_ota_connection_id_key" ON "ota_credentials"("ota_connection_id");

-- CreateIndex
CREATE INDEX "notifications_hotel_id_read_created_at_idx" ON "notifications"("hotel_id", "read", "created_at");

-- AddForeignKey
ALTER TABLE "ota_credentials" ADD CONSTRAINT "ota_credentials_ota_connection_id_fkey" FOREIGN KEY ("ota_connection_id") REFERENCES "ota_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
