-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "bill_to_company_tax_id_type" TEXT,
ADD COLUMN     "bill_to_company_phone" TEXT,
ADD COLUMN     "bill_to_company_email" TEXT,
ADD COLUMN     "bill_to_company_country" TEXT,
ADD COLUMN     "bill_to_company_state" TEXT,
ADD COLUMN     "bill_to_company_city" TEXT,
ADD COLUMN     "bill_to_company_pincode" TEXT;
