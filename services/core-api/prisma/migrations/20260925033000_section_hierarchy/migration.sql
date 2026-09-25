CREATE TABLE "Section" (
  "id" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "parentId" TEXT,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Section_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Section_key_format_check"
    CHECK (char_length("key") <= 63 AND "key" ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'),
  CONSTRAINT "Section_name_nonempty_check"
    CHECK (char_length(btrim("name")) BETWEEN 1 AND 120),
  CONSTRAINT "Section_not_own_parent_check"
    CHECK ("parentId" IS NULL OR "parentId" <> "id")
);

CREATE UNIQUE INDEX "Section_id_siteId_key" ON "Section"("id", "siteId");
CREATE UNIQUE INDEX "Section_siteId_key_key" ON "Section"("siteId", "key");
CREATE INDEX "Section_siteId_parentId_createdAt_id_idx"
  ON "Section"("siteId", "parentId", "createdAt", "id");

ALTER TABLE "Section"
  ADD CONSTRAINT "Section_siteId_fkey"
    FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "Section_parentId_siteId_fkey"
    FOREIGN KEY ("parentId", "siteId") REFERENCES "Section"("id", "siteId") ON DELETE RESTRICT ON UPDATE CASCADE;
