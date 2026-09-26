import { Injectable } from "@nestjs/common";
import { contentTypeSchemaDefinitionSchema } from "@nexora/schemas";
import type { Prisma } from "@prisma/client";

export class InvalidAssetReferenceError extends Error {
  override readonly name = "InvalidAssetReferenceError";
}

type LocaleContent = { data: unknown; localeId: string };

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

@Injectable()
export class ContentAssetRelationService {
  async synchronize(
    transaction: Prisma.TransactionClient,
    siteId: string,
    contentEntryId: string,
    locales: readonly LocaleContent[],
    definition: unknown,
  ) {
    const schema = contentTypeSchemaDefinitionSchema.parse(definition);
    const assetFields = schema.fields.filter(
      (field) => field.fieldType === "media" || field.fieldType === "gallery",
    );
    const relations = locales.flatMap((locale) => {
      const data = record(locale.data);
      return assetFields.flatMap((field) => {
        const value = data[field.key];
        const assetIds =
          field.fieldType === "gallery" ? (Array.isArray(value) ? value : []) : [value];
        return assetIds
          .filter((assetId): assetId is string => typeof assetId === "string")
          .map((assetId, position) => ({
            assetId,
            contentEntryId,
            localeId: locale.localeId,
            position,
            role: field.key,
            siteId,
          }));
      });
    });
    const assetIds = [...new Set(relations.map(({ assetId }) => assetId))];
    if (assetIds.length > 0) {
      const available = await transaction.asset.count({
        where: { id: { in: assetIds }, siteId, status: "READY" },
      });
      if (available !== assetIds.length) throw new InvalidAssetReferenceError();
    }

    const existing = await transaction.contentAssetRelation.findMany({
      select: { description: true, localeId: true, position: true, role: true, title: true },
      where: { contentEntryId, siteId },
    });
    const metadata = new Map(
      existing.map((item) => [
        `${item.localeId}:${item.role}:${item.position}`,
        { description: item.description, title: item.title },
      ]),
    );

    await transaction.contentAssetRelation.deleteMany({ where: { contentEntryId, siteId } });
    if (relations.length > 0) {
      await transaction.contentAssetRelation.createMany({
        data: relations.map((item) => ({
          ...item,
          ...metadata.get(`${item.localeId}:${item.role}:${item.position}`),
        })),
      });
    }
  }
}
