import type { Prisma } from "@prisma/client";
import { contentEntrySnapshotLocalesSchema } from "@nexora/schemas";

const snapshotEntrySelection = {
  contentLocales: {
    orderBy: { localeId: "asc" },
    select: {
      data: true,
      locale: { select: { code: true } },
      localeId: true,
      schemaVersion: true,
    },
  },
  contentTypeId: true,
  publishedAt: true,
  revision: true,
  schemaVersion: true,
  status: true,
} as const;

export async function createContentEntrySnapshot(
  transaction: Prisma.TransactionClient,
  actorId: string,
  siteId: string,
  contentEntryId: string,
) {
  const entry = await transaction.contentEntry.findUniqueOrThrow({
    select: snapshotEntrySelection,
    where: { id_siteId: { id: contentEntryId, siteId } },
  });
  const locales = contentEntrySnapshotLocalesSchema.parse(
    entry.contentLocales.map((locale) => ({
      data: locale.data,
      localeCode: locale.locale.code,
      localeId: locale.localeId,
      schemaVersion: locale.schemaVersion,
    })),
  );

  return transaction.contentEntrySnapshot.create({
    data: {
      actorId,
      contentEntryId,
      contentTypeId: entry.contentTypeId,
      locales: locales as Prisma.InputJsonValue,
      publishedAt: entry.publishedAt,
      revision: entry.revision,
      schemaVersion: entry.schemaVersion,
      siteId,
      status: entry.status,
    },
  });
}
