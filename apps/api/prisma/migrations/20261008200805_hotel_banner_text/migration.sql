/*
  Warnings:

  - You are about to drop the column `banner_file_path` on the `hotels` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "hotels" DROP COLUMN "banner_file_path",
ADD COLUMN     "banner_text" TEXT;
