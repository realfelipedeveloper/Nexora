CREATE TABLE "ContentPlacement" (
  "id" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "sectionId" TEXT NOT NULL,
  "contentEntryId" TEXT NOT NULL,
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "position" INTEGER NOT NULL DEFAULT 0,
  "isVisible" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContentPlacement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContentPlacement_position_nonnegative_check" CHECK ("position" >= 0)
);

CREATE TABLE "SectionRoleAssignment" (
  "id" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "sectionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "roleKey" TEXT NOT NULL,
  "grantedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SectionRoleAssignment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContentPlacement_sectionId_contentEntryId_key"
  ON "ContentPlacement"("sectionId", "contentEntryId");
CREATE UNIQUE INDEX "ContentPlacement_one_primary_per_entry_key"
  ON "ContentPlacement"("siteId", "contentEntryId") WHERE "isPrimary" = true;
CREATE INDEX "ContentPlacement_siteId_sectionId_isVisible_position_id_idx"
  ON "ContentPlacement"("siteId", "sectionId", "isVisible", "position", "id");
CREATE INDEX "ContentPlacement_siteId_contentEntryId_isPrimary_idx"
  ON "ContentPlacement"("siteId", "contentEntryId", "isPrimary");

CREATE UNIQUE INDEX "SectionRoleAssignment_sectionId_userId_roleKey_key"
  ON "SectionRoleAssignment"("sectionId", "userId", "roleKey");
CREATE INDEX "SectionRoleAssignment_siteId_sectionId_userId_idx"
  ON "SectionRoleAssignment"("siteId", "sectionId", "userId");
CREATE INDEX "SectionRoleAssignment_userId_siteId_idx"
  ON "SectionRoleAssignment"("userId", "siteId");
CREATE INDEX "SectionRoleAssignment_roleKey_idx" ON "SectionRoleAssignment"("roleKey");
CREATE INDEX "SectionRoleAssignment_grantedById_idx"
  ON "SectionRoleAssignment"("grantedById");

ALTER TABLE "ContentPlacement"
  ADD CONSTRAINT "ContentPlacement_siteId_fkey"
    FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ContentPlacement_sectionId_siteId_fkey"
    FOREIGN KEY ("sectionId", "siteId") REFERENCES "Section"("id", "siteId") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ContentPlacement_contentEntryId_siteId_fkey"
    FOREIGN KEY ("contentEntryId", "siteId") REFERENCES "ContentEntry"("id", "siteId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SectionRoleAssignment"
  ADD CONSTRAINT "SectionRoleAssignment_siteId_fkey"
    FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "SectionRoleAssignment_sectionId_siteId_fkey"
    FOREIGN KEY ("sectionId", "siteId") REFERENCES "Section"("id", "siteId") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "SectionRoleAssignment_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "SectionRoleAssignment_roleKey_fkey"
    FOREIGN KEY ("roleKey") REFERENCES "Role"("key") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "SectionRoleAssignment_grantedById_fkey"
    FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "prevent_section_hierarchy_cycle"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."parentId" IS NULL THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    WITH RECURSIVE ancestors AS (
      SELECT section."id", section."parentId"
      FROM "Section" AS section
      WHERE section."id" = NEW."parentId" AND section."siteId" = NEW."siteId"

      UNION ALL

      SELECT parent."id", parent."parentId"
      FROM "Section" AS parent
      INNER JOIN ancestors ON parent."id" = ancestors."parentId"
      WHERE parent."siteId" = NEW."siteId"
    )
    SELECT 1 FROM ancestors WHERE "id" = NEW."id"
  ) THEN
    RAISE EXCEPTION 'section hierarchy cycle is not allowed' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Section_prevent_hierarchy_cycle"
BEFORE INSERT OR UPDATE OF "parentId", "siteId" ON "Section"
FOR EACH ROW EXECUTE FUNCTION "prevent_section_hierarchy_cycle"();
