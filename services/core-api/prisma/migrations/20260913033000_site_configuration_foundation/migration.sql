CREATE TYPE "SiteStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

ALTER TABLE "Site"
  ADD COLUMN "status" "SiteStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD CONSTRAINT "Site_key_format_check"
    CHECK (char_length("key") <= 63 AND "key" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  ADD CONSTRAINT "Site_name_not_blank_check"
    CHECK (char_length(btrim("name")) BETWEEN 1 AND 120);

CREATE INDEX "Site_status_idx" ON "Site"("status");

CREATE UNIQUE INDEX "Locale_one_default_per_site_key"
  ON "Locale"("siteId")
  WHERE "isDefault" = true;

CREATE TABLE "GlobalSetting" (
  "key" TEXT NOT NULL,
  "value" JSONB NOT NULL DEFAULT '{}',
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GlobalSetting_pkey" PRIMARY KEY ("key"),
  CONSTRAINT "GlobalSetting_key_format_check"
    CHECK (char_length("key") <= 100 AND "key" ~ '^[a-z][a-z0-9]*([.][a-z][a-z0-9]*)*$'),
  CONSTRAINT "GlobalSetting_value_object_check" CHECK (jsonb_typeof("value") = 'object'),
  CONSTRAINT "GlobalSetting_version_positive_check" CHECK ("version" > 0)
);

CREATE TABLE "SiteSetting" (
  "siteId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "value" JSONB NOT NULL DEFAULT '{}',
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SiteSetting_pkey" PRIMARY KEY ("siteId", "key"),
  CONSTRAINT "SiteSetting_key_format_check"
    CHECK (char_length("key") <= 100 AND "key" ~ '^[a-z][a-z0-9]*([.][a-z][a-z0-9]*)*$'),
  CONSTRAINT "SiteSetting_value_object_check" CHECK (jsonb_typeof("value") = 'object'),
  CONSTRAINT "SiteSetting_version_positive_check" CHECK ("version" > 0)
);

CREATE INDEX "SiteSetting_key_idx" ON "SiteSetting"("key");

ALTER TABLE "SiteSetting"
  ADD CONSTRAINT "SiteSetting_siteId_fkey"
  FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
