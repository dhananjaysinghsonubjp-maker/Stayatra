-- AlterTable
ALTER TABLE "hotels" ADD COLUMN     "accepting_bookings_since" INTEGER,
ADD COLUMN     "built_year" INTEGER,
ADD COLUMN     "contact_email" TEXT,
ADD COLUMN     "contact_landline" TEXT,
ADD COLUMN     "contact_mobile" TEXT,
ADD COLUMN     "contact_mobile_is_whatsapp" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "star_rating" INTEGER,
ADD COLUMN     "works_with_channel_manager" BOOLEAN;
