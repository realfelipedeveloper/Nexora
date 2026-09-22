CREATE TYPE "ContentEntryStatus" AS ENUM ('DRAFT', 'PUBLISHED');

ALTER TABLE "ContentEntry"
  ADD COLUMN "status" "ContentEntryStatus" NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN "publishedAt" TIMESTAMP(3),
  ADD CONSTRAINT "ContentEntry_editorial_state_check"
    CHECK (
      ("status" = 'DRAFT' AND "publishedAt" IS NULL)
      OR ("status" = 'PUBLISHED' AND "publishedAt" IS NOT NULL)
    );

CREATE INDEX "ContentEntry_siteId_status_updatedAt_idx"
  ON "ContentEntry"("siteId", "status", "updatedAt");
