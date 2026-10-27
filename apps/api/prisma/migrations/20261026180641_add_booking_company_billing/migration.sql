-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "bill_to_company_address" TEXT,
ADD COLUMN     "bill_to_company_gstin" TEXT,
ADD COLUMN     "bill_to_company_name" TEXT;
