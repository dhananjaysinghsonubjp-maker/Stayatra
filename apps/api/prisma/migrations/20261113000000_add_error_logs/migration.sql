-- CreateTable
CREATE TABLE "error_logs" (
    "id" TEXT NOT NULL,
    "path" TEXT,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "hotel_id" TEXT,
    "user_id" TEXT,
    "input" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "error_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "error_logs_created_at_idx" ON "error_logs"("created_at");
