CREATE TABLE "ContentTypeSchemaVersion" (
  "id" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "contentTypeId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "definition" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContentTypeSchemaVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContentTypeSchemaVersion_version_positive_check" CHECK ("version" > 0),
  CONSTRAINT "ContentTypeSchemaVersion_definition_object_check" CHECK (jsonb_typeof("definition") = 'object')
);

CREATE UNIQUE INDEX "ContentTypeSchemaVersion_contentTypeId_siteId_version_key"
  ON "ContentTypeSchemaVersion"("contentTypeId", "siteId", "version");
CREATE INDEX "ContentTypeSchemaVersion_siteId_createdAt_idx"
  ON "ContentTypeSchemaVersion"("siteId", "createdAt");

WITH versions AS (
  SELECT "id" AS "contentTypeId", "siteId", "schemaVersion" AS "version"
  FROM "ContentType"
  UNION
  SELECT entry."contentTypeId", entry."siteId", entry."schemaVersion" AS "version"
  FROM "ContentEntry" AS entry
)
INSERT INTO "ContentTypeSchemaVersion" (
  "id",
  "siteId",
  "contentTypeId",
  "version",
  "definition"
)
SELECT
  md5('content-type-schema:' || content_type."id" || ':' || versions."version"::TEXT),
  content_type."siteId",
  content_type."id",
  versions."version",
  jsonb_build_object(
    'key', content_type."key",
    'displayName', content_type."displayName",
    'version', versions."version",
    'fields', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'key', field."key",
            'label', field."label",
            'fieldType', field."fieldType",
            'required', field."required",
            'position', field."position",
            'config', field."config"
          )
          ORDER BY field."position", field."key"
        )
        FROM "FieldDefinition" AS field
        WHERE field."contentTypeId" = content_type."id"
      ),
      '[]'::jsonb
    )
  )
FROM versions
JOIN "ContentType" AS content_type
  ON content_type."id" = versions."contentTypeId"
  AND content_type."siteId" = versions."siteId";

ALTER TABLE "ContentTypeSchemaVersion"
  ADD CONSTRAINT "ContentTypeSchemaVersion_contentTypeId_siteId_fkey"
    FOREIGN KEY ("contentTypeId", "siteId") REFERENCES "ContentType"("id", "siteId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContentEntry"
  ADD CONSTRAINT "ContentEntry_contentTypeId_siteId_schemaVersion_fkey"
    FOREIGN KEY ("contentTypeId", "siteId", "schemaVersion") REFERENCES "ContentTypeSchemaVersion"("contentTypeId", "siteId", "version") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "prevent_content_type_schema_version_update"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Content type schema versions are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ContentTypeSchemaVersion_immutable"
BEFORE UPDATE ON "ContentTypeSchemaVersion"
FOR EACH ROW EXECUTE FUNCTION "prevent_content_type_schema_version_update"();
