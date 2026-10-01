-- AlterTable
ALTER TABLE "ota_room_mappings" ADD COLUMN     "ota_rate_plan_code" TEXT,
ADD COLUMN     "ota_room_code" TEXT;

-- CreateTable
CREATE TABLE "ota_api_logs" (
    "id" TEXT NOT NULL,
    "ota_connection_id" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "request_body" TEXT,
    "response_body" TEXT,
    "http_status" INTEGER,
    "latency_ms" INTEGER,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ota_api_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ota_api_logs_ota_connection_id_created_at_idx" ON "ota_api_logs"("ota_connection_id", "created_at");

-- AddForeignKey
ALTER TABLE "ota_api_logs" ADD CONSTRAINT "ota_api_logs_ota_connection_id_fkey" FOREIGN KEY ("ota_connection_id") REFERENCES "ota_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
