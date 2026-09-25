import { type Prisma } from "@prisma/client";

export type PublicationEventType = "content.published" | "content.unpublished";

export async function replacePublishedProjection(
  transaction: Prisma.TransactionClient,
  siteId: string,
  contentEntryId: string,
  publishedAt: Date,
  editorialRevision: number,
) {
  const entry = await transaction.contentEntry.findUniqueOrThrow({
    select: {
      contentLocales: {
        select: {
          data: true,
          locale: { select: { code: true } },
          localeId: true,
        },
      },
      contentType: { select: { key: true } },
      schemaVersion: true,
    },
    where: { id_siteId: { id: contentEntryId, siteId } },
  });
  const localeIds = entry.contentLocales.map(({ localeId }) => localeId);
  await transaction.publishedContentEntry.deleteMany({
    where: { contentEntryId, localeId: { notIn: localeIds }, siteId },
  });
  for (const localized of entry.contentLocales) {
    await transaction.publishedContentEntry.upsert({
      create: {
        contentEntryId,
        contentTypeKey: entry.contentType.key,
        data: localized.data as Prisma.InputJsonValue,
        editorialRevision,
        localeCode: localized.locale.code,
        localeId: localized.localeId,
        publishedAt,
        schemaVersion: entry.schemaVersion,
        siteId,
      },
      update: {
        contentTypeKey: entry.contentType.key,
        data: localized.data as Prisma.InputJsonValue,
        editorialRevision,
        localeCode: localized.locale.code,
        publishedAt,
        schemaVersion: entry.schemaVersion,
      },
      where: {
        contentEntryId_localeId: { contentEntryId, localeId: localized.localeId },
      },
    });
  }
}

export async function removePublishedProjection(
  transaction: Prisma.TransactionClient,
  siteId: string,
  contentEntryId: string,
) {
  await transaction.publishedContentEntry.deleteMany({ where: { contentEntryId, siteId } });
}

export async function createPublicationEvent(
  transaction: Prisma.TransactionClient,
  input: {
    contentEntryId: string;
    publishedAt: Date | null;
    revision: number;
    siteId: string;
    type: PublicationEventType;
  },
) {
  await transaction.domainEvent.create({
    data: {
      aggregateId: input.contentEntryId,
      aggregateType: "ContentEntry",
      payload: {
        contentEntryId: input.contentEntryId,
        publishedAt: input.publishedAt?.toISOString() ?? null,
        revision: input.revision,
        siteId: input.siteId,
      },
      revision: input.revision,
      siteId: input.siteId,
      type: input.type,
    },
  });
}
