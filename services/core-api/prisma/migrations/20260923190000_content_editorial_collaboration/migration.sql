CREATE TABLE "ContentEntryAssignment" (
  "id" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "contentEntryId" TEXT NOT NULL,
  "assigneeId" TEXT NOT NULL,
  "assignedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContentEntryAssignment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContentEntryAssignment_contentEntryId_siteId_assigneeId_key"
  ON "ContentEntryAssignment"("contentEntryId", "siteId", "assigneeId");
CREATE INDEX "ContentEntryAssignment_siteId_assigneeId_createdAt_idx"
  ON "ContentEntryAssignment"("siteId", "assigneeId", "createdAt");
CREATE INDEX "ContentEntryAssignment_assignedById_idx"
  ON "ContentEntryAssignment"("assignedById");

CREATE TABLE "ContentEntryComment" (
  "id" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "contentEntryId" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "body" VARCHAR(4000) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContentEntryComment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContentEntryComment_body_nonempty_check"
    CHECK (char_length(btrim("body")) BETWEEN 1 AND 4000)
);

CREATE INDEX "ContentEntryComment_contentEntryId_siteId_createdAt_id_idx"
  ON "ContentEntryComment"("contentEntryId", "siteId", "createdAt" DESC, "id" DESC);
CREATE INDEX "ContentEntryComment_siteId_authorId_createdAt_idx"
  ON "ContentEntryComment"("siteId", "authorId", "createdAt");

ALTER TABLE "ContentEntryAssignment"
  ADD CONSTRAINT "ContentEntryAssignment_siteId_fkey"
    FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ContentEntryAssignment_contentEntryId_siteId_fkey"
    FOREIGN KEY ("contentEntryId", "siteId") REFERENCES "ContentEntry"("id", "siteId") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ContentEntryAssignment_assigneeId_fkey"
    FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ContentEntryAssignment_assignedById_fkey"
    FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ContentEntryComment"
  ADD CONSTRAINT "ContentEntryComment_siteId_fkey"
    FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ContentEntryComment_contentEntryId_siteId_fkey"
    FOREIGN KEY ("contentEntryId", "siteId") REFERENCES "ContentEntry"("id", "siteId") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ContentEntryComment_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
