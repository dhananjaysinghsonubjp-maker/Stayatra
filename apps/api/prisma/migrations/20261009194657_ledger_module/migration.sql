-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('cash_in', 'cash_out');

-- AlterTable
ALTER TABLE "hotels" ADD COLUMN     "ledger_opening_balance" DECIMAL(10,2),
ADD COLUMN     "ledger_opening_date" DATE;

-- CreateTable
CREATE TABLE "ledger_categories" (
    "id" TEXT NOT NULL,
    "hotel_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parent_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" TEXT NOT NULL,
    "hotel_id" TEXT NOT NULL,
    "type" "LedgerEntryType" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "payment_method" "PaymentMethod" NOT NULL,
    "category_id" TEXT,
    "remarks" TEXT,
    "is_petty_cash" BOOLEAN NOT NULL DEFAULT false,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ledger_entries_hotel_id_created_at_idx" ON "ledger_entries"("hotel_id", "created_at");

-- AddForeignKey
ALTER TABLE "ledger_categories" ADD CONSTRAINT "ledger_categories_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_categories" ADD CONSTRAINT "ledger_categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "ledger_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "ledger_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
