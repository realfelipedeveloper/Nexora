CREATE INDEX "ContentEntry_siteId_contentTypeId_status_publishedAt_id_idx"
  ON "ContentEntry"("siteId", "contentTypeId", "status", "publishedAt" DESC, "id" DESC);
