CREATE TYPE "PublicationAction" AS ENUM ('PUBLISH', 'UNPUBLISH');
CREATE TYPE "PublicationScheduleStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'CANCELLED', 'FAILED');

CREATE TABLE "PublishedContentEntry" (
  "id" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "contentEntryId" TEXT NOT NULL,
  "localeId" TEXT NOT NULL,
  "contentTypeKey" TEXT NOT NULL,
  "localeCode" TEXT NOT NULL,
  "data" JSONB NOT NULL DEFAULT '{}',
  "schemaVersion" INTEGER NOT NULL,
  "editorialRevision" INTEGER NOT NULL,
  "publishedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PublishedContentEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PublishedContentEntry_versions_check" CHECK ("schemaVersion" > 0 AND "editorialRevision" > 0)
);

CREATE TABLE "PublicationSchedule" (
  "id" TEXT NOT NULL,
  "commandId" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "contentEntryId" TEXT NOT NULL,
  "requestedById" TEXT,
  "action" "PublicationAction" NOT NULL,
  "status" "PublicationScheduleStatus" NOT NULL DEFAULT 'PENDING',
  "scheduledFor" TIMESTAMP(3) NOT NULL,
  "claimedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "failureCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PublicationSchedule_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PublicationSchedule_state_check" CHECK (
    ("status" = 'PENDING' AND "claimedAt" IS NULL AND "completedAt" IS NULL AND "failureCode" IS NULL)
    OR ("status" = 'PROCESSING' AND "claimedAt" IS NOT NULL AND "completedAt" IS NULL AND "failureCode" IS NULL)
    OR ("status" IN ('COMPLETED', 'CANCELLED') AND "completedAt" IS NOT NULL AND "failureCode" IS NULL)
    OR ("status" = 'FAILED' AND "completedAt" IS NOT NULL AND "failureCode" IS NOT NULL)
  )
);

CREATE TABLE "DomainEvent" (
  "id" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "aggregateType" TEXT NOT NULL,
  "aggregateId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "payload" JSONB NOT NULL DEFAULT '{}',
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "publishedAt" TIMESTAMP(3),
  CONSTRAINT "DomainEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DomainEvent_revision_check" CHECK ("revision" > 0)
);

CREATE UNIQUE INDEX "PublishedContentEntry_contentEntryId_localeId_key" ON "PublishedContentEntry"("contentEntryId", "localeId");
CREATE INDEX "PublishedContentEntry_siteId_contentTypeKey_localeCode_publishedAt_contentEntryId_idx" ON "PublishedContentEntry"("siteId", "contentTypeKey", "localeCode", "publishedAt" DESC, "contentEntryId" DESC);
CREATE INDEX "PublishedContentEntry_siteId_localeId_updatedAt_idx" ON "PublishedContentEntry"("siteId", "localeId", "updatedAt");
CREATE UNIQUE INDEX "PublicationSchedule_commandId_key" ON "PublicationSchedule"("commandId");
CREATE UNIQUE INDEX "PublicationSchedule_id_siteId_key" ON "PublicationSchedule"("id", "siteId");
CREATE INDEX "PublicationSchedule_status_scheduledFor_id_idx" ON "PublicationSchedule"("status", "scheduledFor", "id");
CREATE INDEX "PublicationSchedule_siteId_contentEntryId_createdAt_id_idx" ON "PublicationSchedule"("siteId", "contentEntryId", "createdAt" DESC, "id" DESC);
CREATE UNIQUE INDEX "PublicationSchedule_one_pending_per_entry_action" ON "PublicationSchedule"("siteId", "contentEntryId", "action") WHERE "status" = 'PENDING';
CREATE UNIQUE INDEX "DomainEvent_aggregateId_type_revision_key" ON "DomainEvent"("aggregateId", "type", "revision");
CREATE INDEX "DomainEvent_publishedAt_occurredAt_id_idx" ON "DomainEvent"("publishedAt", "occurredAt", "id");
CREATE INDEX "DomainEvent_siteId_aggregateType_aggregateId_occurredAt_idx" ON "DomainEvent"("siteId", "aggregateType", "aggregateId", "occurredAt" DESC);

ALTER TABLE "PublishedContentEntry" ADD CONSTRAINT "PublishedContentEntry_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PublishedContentEntry" ADD CONSTRAINT "PublishedContentEntry_contentEntryId_siteId_fkey" FOREIGN KEY ("contentEntryId", "siteId") REFERENCES "ContentEntry"("id", "siteId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PublishedContentEntry" ADD CONSTRAINT "PublishedContentEntry_localeId_siteId_fkey" FOREIGN KEY ("localeId", "siteId") REFERENCES "Locale"("id", "siteId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PublicationSchedule" ADD CONSTRAINT "PublicationSchedule_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PublicationSchedule" ADD CONSTRAINT "PublicationSchedule_contentEntryId_siteId_fkey" FOREIGN KEY ("contentEntryId", "siteId") REFERENCES "ContentEntry"("id", "siteId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PublicationSchedule" ADD CONSTRAINT "PublicationSchedule_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DomainEvent" ADD CONSTRAINT "DomainEvent_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "PublishedContentEntry" (
  "id", "siteId", "contentEntryId", "localeId", "contentTypeKey", "localeCode", "data",
  "schemaVersion", "editorialRevision", "publishedAt", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  entry."siteId",
  entry."id",
  localized."localeId",
  content_type."key",
  locale."code",
  localized."data",
  entry."schemaVersion",
  entry."revision",
  entry."publishedAt",
  CURRENT_TIMESTAMP,
  entry."updatedAt"
FROM "ContentEntry" entry
JOIN "ContentType" content_type ON content_type."id" = entry."contentTypeId" AND content_type."siteId" = entry."siteId"
JOIN "ContentLocale" localized ON localized."contentEntryId" = entry."id" AND localized."siteId" = entry."siteId"
JOIN "Locale" locale ON locale."id" = localized."localeId" AND locale."siteId" = entry."siteId"
WHERE entry."status" = 'PUBLISHED' AND entry."publishedAt" IS NOT NULL;
