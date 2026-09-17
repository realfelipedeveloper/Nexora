ALTER TABLE "ContentType"
  ADD CONSTRAINT "ContentType_key_format_check"
    CHECK (char_length("key") <= 63 AND "key" ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'),
  ADD CONSTRAINT "ContentType_displayName_nonempty_check"
    CHECK (char_length("displayName") <= 120 AND char_length(btrim("displayName")) > 0),
  ADD CONSTRAINT "ContentType_schemaVersion_positive_check"
    CHECK ("schemaVersion" > 0);

ALTER TABLE "FieldDefinition"
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD CONSTRAINT "FieldDefinition_key_format_check"
    CHECK (char_length("key") <= 63 AND "key" ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'),
  ADD CONSTRAINT "FieldDefinition_label_nonempty_check"
    CHECK (char_length("label") <= 120 AND char_length(btrim("label")) > 0),
  ADD CONSTRAINT "FieldDefinition_fieldType_supported_check"
    CHECK ("fieldType" IN (
      'text', 'textarea', 'richText', 'integer', 'decimal', 'boolean', 'date', 'datetime',
      'select', 'multiSelect', 'media', 'gallery', 'relation', 'taxonomy', 'url', 'email',
      'color', 'json'
    )),
  ADD CONSTRAINT "FieldDefinition_position_nonnegative_check"
    CHECK ("position" >= 0),
  ADD CONSTRAINT "FieldDefinition_config_object_check"
    CHECK (jsonb_typeof("config") = 'object');

CREATE UNIQUE INDEX "Locale_id_siteId_key" ON "Locale"("id", "siteId");
CREATE UNIQUE INDEX "ContentType_id_siteId_key" ON "ContentType"("id", "siteId");

CREATE TABLE "ContentEntry" (
  "id" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "contentTypeId" TEXT NOT NULL,
  "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContentEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContentEntry_schemaVersion_positive_check" CHECK ("schemaVersion" > 0),
  CONSTRAINT "ContentEntry_revision_positive_check" CHECK ("revision" > 0)
);

CREATE UNIQUE INDEX "ContentEntry_id_siteId_key" ON "ContentEntry"("id", "siteId");
CREATE INDEX "ContentEntry_siteId_contentTypeId_updatedAt_idx"
  ON "ContentEntry"("siteId", "contentTypeId", "updatedAt");

CREATE TABLE "ContentLocale" (
  "id" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "contentEntryId" TEXT NOT NULL,
  "localeId" TEXT NOT NULL,
  "data" JSONB NOT NULL DEFAULT '{}',
  "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContentLocale_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContentLocale_data_object_check" CHECK (jsonb_typeof("data") = 'object'),
  CONSTRAINT "ContentLocale_schemaVersion_positive_check" CHECK ("schemaVersion" > 0),
  CONSTRAINT "ContentLocale_revision_positive_check" CHECK ("revision" > 0)
);

CREATE UNIQUE INDEX "ContentLocale_contentEntryId_localeId_key"
  ON "ContentLocale"("contentEntryId", "localeId");
CREATE INDEX "ContentLocale_siteId_localeId_updatedAt_idx"
  ON "ContentLocale"("siteId", "localeId", "updatedAt");

ALTER TABLE "ContentEntry"
  ADD CONSTRAINT "ContentEntry_siteId_fkey"
    FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ContentEntry_contentTypeId_siteId_fkey"
    FOREIGN KEY ("contentTypeId", "siteId") REFERENCES "ContentType"("id", "siteId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ContentLocale"
  ADD CONSTRAINT "ContentLocale_contentEntryId_siteId_fkey"
    FOREIGN KEY ("contentEntryId", "siteId") REFERENCES "ContentEntry"("id", "siteId") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ContentLocale_localeId_siteId_fkey"
    FOREIGN KEY ("localeId", "siteId") REFERENCES "Locale"("id", "siteId") ON DELETE RESTRICT ON UPDATE CASCADE;
