ALTER TABLE "Locale"
  ADD COLUMN "fallbackLocaleId" TEXT,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "Locale"
  ADD CONSTRAINT "Locale_fallback_not_self_check"
  CHECK ("fallbackLocaleId" IS NULL OR "fallbackLocaleId" <> "id"),
  ADD CONSTRAINT "Locale_version_positive_check"
  CHECK ("version" > 0);

CREATE INDEX "Locale_siteId_fallbackLocaleId_idx"
  ON "Locale"("siteId", "fallbackLocaleId");

ALTER TABLE "Locale"
  ADD CONSTRAINT "Locale_fallbackLocaleId_siteId_fkey"
  FOREIGN KEY ("fallbackLocaleId", "siteId")
  REFERENCES "Locale"("id", "siteId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
