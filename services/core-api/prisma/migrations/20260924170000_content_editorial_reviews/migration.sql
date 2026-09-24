CREATE TYPE "ContentEntryReviewDecision" AS ENUM ('APPROVED', 'CHANGES_REQUESTED');

CREATE TABLE "ContentEntryReview" (
  "id" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "contentEntryId" TEXT NOT NULL,
  "reviewerId" TEXT NOT NULL,
  "decision" "ContentEntryReviewDecision" NOT NULL,
  "contentRevision" INTEGER NOT NULL,
  "note" VARCHAR(4000),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContentEntryReview_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContentEntryReview_contentRevision_positive_check"
    CHECK ("contentRevision" > 0),
  CONSTRAINT "ContentEntryReview_note_nonempty_check"
    CHECK ("note" IS NULL OR char_length(btrim("note")) BETWEEN 1 AND 4000),
  CONSTRAINT "ContentEntryReview_changes_note_required_check"
    CHECK ("decision" <> 'CHANGES_REQUESTED' OR "note" IS NOT NULL)
);

CREATE UNIQUE INDEX "ContentEntryReview_contentEntryId_siteId_contentRevision_reviewerId_decision_key"
  ON "ContentEntryReview"("contentEntryId", "siteId", "contentRevision", "reviewerId", "decision");
CREATE INDEX "ContentEntryReview_contentEntryId_siteId_createdAt_id_idx"
  ON "ContentEntryReview"("contentEntryId", "siteId", "createdAt" DESC, "id" DESC);
CREATE INDEX "ContentEntryReview_siteId_reviewerId_createdAt_idx"
  ON "ContentEntryReview"("siteId", "reviewerId", "createdAt");

ALTER TABLE "ContentEntryReview"
  ADD CONSTRAINT "ContentEntryReview_siteId_fkey"
    FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ContentEntryReview_contentEntryId_siteId_fkey"
    FOREIGN KEY ("contentEntryId", "siteId") REFERENCES "ContentEntry"("id", "siteId") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ContentEntryReview_reviewerId_fkey"
    FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
