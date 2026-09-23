-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PaymentMethod" ADD VALUE 'bank_transfer';
ALTER TYPE "PaymentMethod" ADD VALUE 'company_settlement';
ALTER TYPE "PaymentMethod" ADD VALUE 'agent_settlement';
ALTER TYPE "PaymentMethod" ADD VALUE 'upi';
ALTER TYPE "PaymentMethod" ADD VALUE 'credit_sale';
ALTER TYPE "PaymentMethod" ADD VALUE 'cheque';
ALTER TYPE "PaymentMethod" ADD VALUE 'cash_deposit';

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "discount_amount" DECIMAL(10,2),
ADD COLUMN     "gst_exempt" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "receipt_photo_path" TEXT,
ADD COLUMN     "reference_number" TEXT;

-- CreateTable
CREATE TABLE "invoice_line_items" (
    "id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit_price" DECIMAL(10,2) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_line_items_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
