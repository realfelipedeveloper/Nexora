ALTER TYPE "ContentEntryStatus" ADD VALUE 'IN_REVIEW' BEFORE 'PUBLISHED';
ALTER TYPE "ContentEntryStatus" ADD VALUE 'ARCHIVED' AFTER 'PUBLISHED';

ALTER TABLE "ContentEntry"
  DROP CONSTRAINT "ContentEntry_editorial_state_check";

ALTER TABLE "ContentEntry"
  ADD CONSTRAINT "ContentEntry_editorial_state_check"
  CHECK (
    ("status" = 'PUBLISHED' AND "publishedAt" IS NOT NULL)
    OR ("status" <> 'PUBLISHED' AND "publishedAt" IS NULL)
  );
