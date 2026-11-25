BEGIN;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "tag_kind" AS ENUM ('mood', 'situation');

-- CreateEnum
CREATE TYPE "place_setting" AS ENUM ('indoor', 'outdoor', 'mixed');

-- CreateEnum
CREATE TYPE "place_status" AS ENUM ('draft', 'published', 'hidden');

-- CreateTable
CREATE TABLE "regions" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,

    CONSTRAINT "regions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" SERIAL NOT NULL,
    "kind" "tag_kind" NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "places" (
    "id" SERIAL NOT NULL,
    "region_id" INTEGER NOT NULL,
    "category_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "summary" TEXT,
    "overview" TEXT,
    "address" TEXT NOT NULL,
    "latitude" DECIMAL(9,6) NOT NULL,
    "longitude" DECIMAL(9,6) NOT NULL,
    "setting" "place_setting",
    "status" "place_status" NOT NULL DEFAULT 'draft',
    "kakao_map_url" TEXT,
    "naver_map_url" TEXT,
    "verified_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "places_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "places_latitude_check" CHECK ("latitude" BETWEEN -90 AND 90),
    CONSTRAINT "places_longitude_check" CHECK ("longitude" BETWEEN -180 AND 180)
);

-- CreateTable
CREATE TABLE "place_sources" (
    "place_id" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "content_type_id" TEXT,
    "source_url" TEXT,
    "source_modified_at" TIMESTAMPTZ(6),
    "last_synced_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "place_sources_pkey" PRIMARY KEY ("provider","external_id")
);

-- CreateTable
CREATE TABLE "place_tags" (
    "place_id" INTEGER NOT NULL,
    "tag_id" INTEGER NOT NULL,

    CONSTRAINT "place_tags_pkey" PRIMARY KEY ("place_id","tag_id")
);

-- CreateTable
CREATE TABLE "place_images" (
    "id" SERIAL NOT NULL,
    "place_id" INTEGER NOT NULL,
    "image_url" TEXT NOT NULL,
    "alt_text" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "source_url" TEXT,
    "provider" TEXT,
    "license_code" TEXT,
    "usage_basis" TEXT NOT NULL,
    "attribution_text" TEXT,

    CONSTRAINT "place_images_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "place_images_sort_order_check" CHECK ("sort_order" >= 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "regions_slug_key" ON "regions"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "tags_kind_slug_key" ON "tags"("kind", "slug");

-- CreateIndex
CREATE INDEX "places_status_created_at_id_idx" ON "places"("status", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "places_region_id_idx" ON "places"("region_id");

-- CreateIndex
CREATE INDEX "places_category_id_idx" ON "places"("category_id");

-- CreateIndex
CREATE UNIQUE INDEX "place_sources_place_id_provider_key" ON "place_sources"("place_id", "provider");

-- CreateIndex
CREATE INDEX "place_tags_tag_id_place_id_idx" ON "place_tags"("tag_id", "place_id");

-- CreateIndex
CREATE UNIQUE INDEX "place_images_place_id_sort_order_key" ON "place_images"("place_id", "sort_order");

-- AddForeignKey
ALTER TABLE "places" ADD CONSTRAINT "places_region_id_fkey" FOREIGN KEY ("region_id") REFERENCES "regions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "places" ADD CONSTRAINT "places_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "place_sources" ADD CONSTRAINT "place_sources_place_id_fkey" FOREIGN KEY ("place_id") REFERENCES "places"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "place_tags" ADD CONSTRAINT "place_tags_place_id_fkey" FOREIGN KEY ("place_id") REFERENCES "places"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "place_tags" ADD CONSTRAINT "place_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "place_images" ADD CONSTRAINT "place_images_place_id_fkey" FOREIGN KEY ("place_id") REFERENCES "places"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
