CREATE TABLE "ContentPreviewToken" (
    "id" TEXT NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "siteId" TEXT NOT NULL,
    "contentEntryId" TEXT NOT NULL,
    "localeId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "createdById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentPreviewToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContentPreviewToken_tokenHash_key"
    ON "ContentPreviewToken"("tokenHash");
CREATE INDEX "ContentPreviewToken_expiresAt_idx"
    ON "ContentPreviewToken"("expiresAt");
CREATE INDEX "ContentPreviewToken_siteId_contentEntryId_revision_idx"
    ON "ContentPreviewToken"("siteId", "contentEntryId", "revision");
CREATE INDEX "ContentPreviewToken_createdById_createdAt_idx"
    ON "ContentPreviewToken"("createdById", "createdAt" DESC);

ALTER TABLE "ContentPreviewToken"
    ADD CONSTRAINT "ContentPreviewToken_siteId_fkey"
    FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContentPreviewToken"
    ADD CONSTRAINT "ContentPreviewToken_contentEntryId_siteId_fkey"
    FOREIGN KEY ("contentEntryId", "siteId") REFERENCES "ContentEntry"("id", "siteId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContentPreviewToken"
    ADD CONSTRAINT "ContentPreviewToken_localeId_siteId_fkey"
    FOREIGN KEY ("localeId", "siteId") REFERENCES "Locale"("id", "siteId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContentPreviewToken"
    ADD CONSTRAINT "ContentPreviewToken_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
