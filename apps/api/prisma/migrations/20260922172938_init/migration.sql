-- CreateEnum
CREATE TYPE "ModuleType" AS ENUM ('channel_manager', 'pms', 'theft_protection');

-- CreateEnum
CREATE TYPE "OtaCode" AS ENUM ('mmt_goibibo', 'booking_com', 'agoda', 'cleartrip', 'expedia', 'airbnb');

-- CreateEnum
CREATE TYPE "RateSource" AS ENUM ('bulk_update', 'value_override', 'ota_push');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('confirmed', 'checked_in', 'checked_out', 'cancelled');

-- CreateEnum
CREATE TYPE "BookingSource" AS ENUM ('mmt_goibibo', 'booking_com', 'agoda', 'cleartrip', 'expedia', 'airbnb', 'direct', 'walk_in');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('cash', 'online', 'card');

-- CreateEnum
CREATE TYPE "RoomStatus" AS ENUM ('available', 'occupied', 'housekeeping');

-- CreateEnum
CREATE TYPE "CleaningKind" AS ENUM ('checkout', 'guest_stay');

-- CreateEnum
CREATE TYPE "AuditEventType" AS ENUM ('CHECK_IN', 'PAYMENT_RECEIVED', 'CLEANING_SUBMITTED', 'CLEANING_FLAGGED', 'DISCREPANCY_RESOLVED', 'STAY_EDITED', 'ROOM_CHANGED', 'GUEST_CLEANING', 'MANUAL_BLOCK', 'UNRECORDED_OCCUPANCY_FLAGGED');

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "plan_tier" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_modules" (
    "organization_id" TEXT NOT NULL,
    "module" "ModuleType" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "organization_modules_pkey" PRIMARY KEY ("organization_id","module")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_module_roles" (
    "user_id" TEXT NOT NULL,
    "module" "ModuleType" NOT NULL,
    "role" TEXT NOT NULL,

    CONSTRAINT "user_module_roles_pkey" PRIMARY KEY ("user_id","module")
);

-- CreateTable
CREATE TABLE "hotels" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT,
    "short_code" TEXT NOT NULL,
    "gst_registration" TEXT,
    "dpdp_consent_at" TIMESTAMP(3),
    "expected_room_count" INTEGER,
    "expected_staff_count" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hotels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_categories" (
    "id" TEXT NOT NULL,
    "hotel_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "room_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_plans" (
    "id" TEXT NOT NULL,
    "room_category_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "meal_plan" TEXT,
    "is_derived" BOOLEAN NOT NULL DEFAULT false,
    "base_rate_plan_id" TEXT,
    "formula" TEXT,

    CONSTRAINT "rate_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ota_connections" (
    "id" TEXT NOT NULL,
    "hotel_id" TEXT NOT NULL,
    "ota_code" "OtaCode" NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "credential_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ota_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ota_room_mappings" (
    "id" TEXT NOT NULL,
    "ota_connection_id" TEXT NOT NULL,
    "room_category_id" TEXT NOT NULL,
    "ota_room_name" TEXT NOT NULL,

    CONSTRAINT "ota_room_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_rates" (
    "id" TEXT NOT NULL,
    "rate_plan_id" TEXT NOT NULL,
    "ota_connection_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "occupancy_tier" INTEGER NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "extra_adult_price" DECIMAL(10,2),
    "child_1_price" DECIMAL(10,2),
    "child_2_price" DECIMAL(10,2),
    "availability" INTEGER NOT NULL,
    "is_derived_value" BOOLEAN NOT NULL DEFAULT false,
    "source" "RateSource" NOT NULL,
    "changed_by" TEXT NOT NULL,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restrictions" (
    "id" TEXT NOT NULL,
    "rate_plan_id" TEXT NOT NULL,
    "ota_connection_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "channel_blocked" BOOLEAN NOT NULL DEFAULT false,
    "rate_plan_closed" BOOLEAN NOT NULL DEFAULT false,
    "closed_to_arrival" BOOLEAN NOT NULL DEFAULT false,
    "closed_to_departure" BOOLEAN NOT NULL DEFAULT false,
    "min_los" INTEGER,
    "max_los" INTEGER,
    "bookable_nights" INTEGER,
    "policy_override_id" TEXT,
    "min_los_arrival" INTEGER,
    "max_los_arrival" INTEGER,
    "exact_los_arrival" INTEGER,
    "min_advance_days" INTEGER,
    "max_advance_days" INTEGER,
    "cap" INTEGER,
    "cutoff_hours" INTEGER,
    "allocation_count" INTEGER,

    CONSTRAINT "restrictions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" TEXT NOT NULL,
    "hotel_id" TEXT NOT NULL,
    "ota_connection_id" TEXT,
    "ota_booking_ref" TEXT,
    "guest_name" TEXT NOT NULL,
    "guest_phone" TEXT,
    "room_category_id" TEXT NOT NULL,
    "rate_plan_id" TEXT,
    "check_in" DATE NOT NULL,
    "check_out" DATE NOT NULL,
    "nights" INTEGER NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'confirmed',
    "source" "BookingSource" NOT NULL,
    "paid_amount" DECIMAL(10,2),
    "payment_method" TEXT,
    "delay_resolved_at" TIMESTAMP(3),
    "delay_resolved_by" TEXT,
    "delay_resolved_note" TEXT,
    "total_amount" DECIMAL(10,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "collected_by" TEXT NOT NULL,
    "collected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rooms" (
    "id" TEXT NOT NULL,
    "hotel_id" TEXT NOT NULL,
    "room_category_id" TEXT NOT NULL,
    "room_number" TEXT NOT NULL,
    "status" "RoomStatus" NOT NULL DEFAULT 'available',
    "current_stay_id" TEXT,
    "status_changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cleaning_records" (
    "id" TEXT NOT NULL,
    "hotel_id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "stay_id" TEXT,
    "kind" "CleaningKind" NOT NULL,
    "primary_housekeeper_id" TEXT NOT NULL,
    "second_housekeeper_id" TEXT,
    "photos" JSONB NOT NULL DEFAULT '[]',
    "flagged" BOOLEAN NOT NULL DEFAULT false,
    "resolved_at" TIMESTAMP(3),
    "resolved_by" TEXT,
    "resolved_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cleaning_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "hotel_id" TEXT NOT NULL,
    "event_type" "AuditEventType" NOT NULL,
    "actor_id" TEXT NOT NULL,
    "subject_id" TEXT,
    "detail" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_attempts" (
    "id" TEXT NOT NULL,
    "hotel_id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "succeeded" BOOLEAN NOT NULL,
    "attempted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "hotels_short_code_key" ON "hotels"("short_code");

-- CreateIndex
CREATE UNIQUE INDEX "ota_connections_hotel_id_ota_code_key" ON "ota_connections"("hotel_id", "ota_code");

-- CreateIndex
CREATE UNIQUE INDEX "ota_room_mappings_ota_connection_id_room_category_id_key" ON "ota_room_mappings"("ota_connection_id", "room_category_id");

-- CreateIndex
CREATE INDEX "inventory_rates_rate_plan_id_date_idx" ON "inventory_rates"("rate_plan_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_rates_rate_plan_id_ota_connection_id_date_occupan_key" ON "inventory_rates"("rate_plan_id", "ota_connection_id", "date", "occupancy_tier");

-- CreateIndex
CREATE INDEX "restrictions_rate_plan_id_date_idx" ON "restrictions"("rate_plan_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "restrictions_rate_plan_id_ota_connection_id_date_key" ON "restrictions"("rate_plan_id", "ota_connection_id", "date");

-- CreateIndex
CREATE INDEX "bookings_hotel_id_check_in_idx" ON "bookings"("hotel_id", "check_in");

-- CreateIndex
CREATE INDEX "bookings_hotel_id_status_idx" ON "bookings"("hotel_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "rooms_current_stay_id_key" ON "rooms"("current_stay_id");

-- CreateIndex
CREATE UNIQUE INDEX "rooms_hotel_id_room_number_key" ON "rooms"("hotel_id", "room_number");

-- CreateIndex
CREATE INDEX "audit_log_hotel_id_created_at_idx" ON "audit_log"("hotel_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_key" ON "sessions"("token");

-- CreateIndex
CREATE INDEX "login_attempts_hotel_id_device_id_attempted_at_idx" ON "login_attempts"("hotel_id", "device_id", "attempted_at");

-- AddForeignKey
ALTER TABLE "organization_modules" ADD CONSTRAINT "organization_modules_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_module_roles" ADD CONSTRAINT "user_module_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hotels" ADD CONSTRAINT "hotels_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_categories" ADD CONSTRAINT "room_categories_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rate_plans" ADD CONSTRAINT "rate_plans_room_category_id_fkey" FOREIGN KEY ("room_category_id") REFERENCES "room_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rate_plans" ADD CONSTRAINT "rate_plans_base_rate_plan_id_fkey" FOREIGN KEY ("base_rate_plan_id") REFERENCES "rate_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ota_connections" ADD CONSTRAINT "ota_connections_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ota_room_mappings" ADD CONSTRAINT "ota_room_mappings_ota_connection_id_fkey" FOREIGN KEY ("ota_connection_id") REFERENCES "ota_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ota_room_mappings" ADD CONSTRAINT "ota_room_mappings_room_category_id_fkey" FOREIGN KEY ("room_category_id") REFERENCES "room_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_rates" ADD CONSTRAINT "inventory_rates_rate_plan_id_fkey" FOREIGN KEY ("rate_plan_id") REFERENCES "rate_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_rates" ADD CONSTRAINT "inventory_rates_ota_connection_id_fkey" FOREIGN KEY ("ota_connection_id") REFERENCES "ota_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restrictions" ADD CONSTRAINT "restrictions_rate_plan_id_fkey" FOREIGN KEY ("rate_plan_id") REFERENCES "rate_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restrictions" ADD CONSTRAINT "restrictions_ota_connection_id_fkey" FOREIGN KEY ("ota_connection_id") REFERENCES "ota_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_ota_connection_id_fkey" FOREIGN KEY ("ota_connection_id") REFERENCES "ota_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_rate_plan_id_fkey" FOREIGN KEY ("rate_plan_id") REFERENCES "rate_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_room_category_id_fkey" FOREIGN KEY ("room_category_id") REFERENCES "room_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_current_stay_id_fkey" FOREIGN KEY ("current_stay_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cleaning_records" ADD CONSTRAINT "cleaning_records_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cleaning_records" ADD CONSTRAINT "cleaning_records_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_attempts" ADD CONSTRAINT "login_attempts_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "hotels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
