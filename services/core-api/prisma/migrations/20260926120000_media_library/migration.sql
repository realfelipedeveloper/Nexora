CREATE TYPE "AssetStatus" AS ENUM ('READY');

CREATE TABLE "Asset" (
  "id" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "status" "AssetStatus" NOT NULL DEFAULT 'READY',
  "originalName" VARCHAR(255) NOT NULL,
  "displayName" VARCHAR(255) NOT NULL,
  "altText" VARCHAR(500),
  "mimeType" VARCHAR(127) NOT NULL,
  "extension" VARCHAR(16) NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "checksumSha256" CHAR(64) NOT NULL,
  "storageKey" VARCHAR(500) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContentAssetRelation" (
  "id" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "contentEntryId" TEXT NOT NULL,
  "assetId" TEXT NOT NULL,
  "localeId" TEXT NOT NULL,
  "role" VARCHAR(63) NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  "title" VARCHAR(255),
  "description" VARCHAR(1000),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContentAssetRelation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Asset_storageKey_key" ON "Asset"("storageKey");
CREATE UNIQUE INDEX "Asset_id_siteId_key" ON "Asset"("id", "siteId");
CREATE INDEX "Asset_siteId_createdAt_id_idx" ON "Asset"("siteId", "createdAt" DESC, "id" DESC);
CREATE INDEX "Asset_siteId_mimeType_createdAt_idx" ON "Asset"("siteId", "mimeType", "createdAt" DESC);
CREATE INDEX "Asset_checksumSha256_idx" ON "Asset"("checksumSha256");
CREATE UNIQUE INDEX "ContentAssetRelation_contentEntryId_localeId_role_position_key" ON "ContentAssetRelation"("contentEntryId", "localeId", "role", "position");
CREATE INDEX "ContentAssetRelation_assetId_siteId_createdAt_idx" ON "ContentAssetRelation"("assetId", "siteId", "createdAt" DESC);
CREATE INDEX "ContentAssetRelation_contentEntryId_siteId_role_position_idx" ON "ContentAssetRelation"("contentEntryId", "siteId", "role", "position");

ALTER TABLE "Asset" ADD CONSTRAINT "Asset_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ContentAssetRelation" ADD CONSTRAINT "ContentAssetRelation_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContentAssetRelation" ADD CONSTRAINT "ContentAssetRelation_contentEntryId_siteId_fkey" FOREIGN KEY ("contentEntryId", "siteId") REFERENCES "ContentEntry"("id", "siteId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContentAssetRelation" ADD CONSTRAINT "ContentAssetRelation_assetId_siteId_fkey" FOREIGN KEY ("assetId", "siteId") REFERENCES "Asset"("id", "siteId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ContentAssetRelation" ADD CONSTRAINT "ContentAssetRelation_localeId_siteId_fkey" FOREIGN KEY ("localeId", "siteId") REFERENCES "Locale"("id", "siteId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Asset" ADD CONSTRAINT "Asset_sizeBytes_check" CHECK ("sizeBytes" > 0 AND "sizeBytes" <= 20971520);
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_version_check" CHECK ("version" > 0);
ALTER TABLE "ContentAssetRelation" ADD CONSTRAINT "ContentAssetRelation_position_check" CHECK ("position" >= 0);
