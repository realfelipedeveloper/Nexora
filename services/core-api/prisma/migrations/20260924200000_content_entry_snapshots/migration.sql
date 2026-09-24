CREATE TABLE "ContentEntrySnapshot" (
  "id" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "contentEntryId" TEXT NOT NULL,
  "contentTypeId" TEXT NOT NULL,
  "actorId" TEXT,
  "revision" INTEGER NOT NULL,
  "schemaVersion" INTEGER NOT NULL,
  "status" "ContentEntryStatus" NOT NULL,
  "publishedAt" TIMESTAMP(3),
  "locales" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContentEntrySnapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContentEntrySnapshot_revision_positive_check" CHECK ("revision" > 0),
  CONSTRAINT "ContentEntrySnapshot_schemaVersion_positive_check" CHECK ("schemaVersion" > 0),
  CONSTRAINT "ContentEntrySnapshot_locales_array_check" CHECK (jsonb_typeof("locales") = 'array')
);

CREATE UNIQUE INDEX "ContentEntrySnapshot_contentEntryId_siteId_revision_key"
  ON "ContentEntrySnapshot"("contentEntryId", "siteId", "revision");
CREATE INDEX "ContentEntrySnapshot_contentEntryId_siteId_revision_idx"
  ON "ContentEntrySnapshot"("contentEntryId", "siteId", "revision" DESC);
CREATE INDEX "ContentEntrySnapshot_siteId_createdAt_id_idx"
  ON "ContentEntrySnapshot"("siteId", "createdAt" DESC, "id" DESC);

ALTER TABLE "ContentEntrySnapshot"
  ADD CONSTRAINT "ContentEntrySnapshot_siteId_fkey"
    FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ContentEntrySnapshot_contentEntryId_siteId_fkey"
    FOREIGN KEY ("contentEntryId", "siteId") REFERENCES "ContentEntry"("id", "siteId") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "ContentEntrySnapshot" (
  "id",
  "siteId",
  "contentEntryId",
  "contentTypeId",
  "revision",
  "schemaVersion",
  "status",
  "publishedAt",
  "locales",
  "createdAt"
)
SELECT
  md5('content-entry-snapshot:' || entry."id" || ':' || entry."revision"::TEXT),
  entry."siteId",
  entry."id",
  entry."contentTypeId",
  entry."revision",
  entry."schemaVersion",
  entry."status",
  entry."publishedAt",
  COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'localeId', content_locale."localeId",
          'localeCode', locale."code",
          'schemaVersion', content_locale."schemaVersion",
          'data', content_locale."data"
        )
        ORDER BY content_locale."localeId"
      )
      FROM "ContentLocale" AS content_locale
      JOIN "Locale" AS locale
        ON locale."id" = content_locale."localeId"
        AND locale."siteId" = content_locale."siteId"
      WHERE content_locale."contentEntryId" = entry."id"
        AND content_locale."siteId" = entry."siteId"
    ),
    '[]'::jsonb
  ),
  entry."updatedAt"
FROM "ContentEntry" AS entry;

CREATE FUNCTION "reject_content_entry_snapshot_update"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Content entry snapshots are immutable.' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ContentEntrySnapshot_reject_update"
BEFORE UPDATE ON "ContentEntrySnapshot"
FOR EACH ROW EXECUTE FUNCTION "reject_content_entry_snapshot_update"();
