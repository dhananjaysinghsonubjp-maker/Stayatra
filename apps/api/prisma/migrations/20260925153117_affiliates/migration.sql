-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "referred_by_affiliate_id" TEXT;

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "affiliate_id" TEXT;

-- CreateTable
CREATE TABLE "affiliates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "commission_rate" DECIMAL(5,2),
    "brand_name" TEXT,
    "logo_url" TEXT,
    "primary_color" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "affiliates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "affiliates_email_key" ON "affiliates"("email");

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_referred_by_affiliate_id_fkey" FOREIGN KEY ("referred_by_affiliate_id") REFERENCES "affiliates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_affiliate_id_fkey" FOREIGN KEY ("affiliate_id") REFERENCES "affiliates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
