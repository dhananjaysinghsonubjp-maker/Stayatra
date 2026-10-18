-- AlterTable
ALTER TABLE "hotels" ADD COLUMN     "invoice_stamp_path" TEXT,
ADD COLUMN     "invoice_terms" TEXT,
ADD COLUMN     "license_number" TEXT,
ADD COLUMN     "show_payment_summary_on_invoice" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "show_terms_on_invoice" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "upi_id" TEXT;
