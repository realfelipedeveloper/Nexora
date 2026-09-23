import { Inject, Injectable } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  contentEntryCreateSchema,
  contentEntryStatusUpdateSchema,
  contentEntryUpdateSchema,
  contentTypeCreateSchema,
  contentTypeUpdateSchema,
  findContentEntryWorkflowTransition,
  type ContentEntryCreateInput,
  type ContentEntryWorkflowTransition,
  type ContentEntryStatusUpdateInput,
  type ContentEntryUpdateInput,
  type ContentTypeCreateInput,
  type ContentTypeUpdateInput,
} from "@nexora/schemas";
import { InjectPrismaClient } from "../../database/database.module.js";
import type { SiteAccess } from "../identity/site-permissions.js";
import { ContentFieldValidator } from "./content-field-validator.js";
import { ContentMetrics } from "./content-metrics.js";
import { canSetContentWorkflowState } from "./content-workflow-authorization.js";

const defaultPageSize = 25;
const maximumPageSize = 100;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const fieldSelection = {
  config: true,
  createdAt: true,
  fieldType: true,
  id: true,
  key: true,
  label: true,
  position: true,
  required: true,
  updatedAt: true,
} as const;

const fieldOrder: Prisma.FieldDefinitionOrderByWithRelationInput[] = [
  { position: "asc" },
  { key: "asc" },
];

const contentTypeSummarySelection = {
  createdAt: true,
  displayName: true,
  id: true,
  key: true,
  schemaVersion: true,
  updatedAt: true,
} as const;

const contentTypeDetailSelection = {
  ...contentTypeSummarySelection,
  fields: {
    orderBy: fieldOrder,
    select: fieldSelection,
  },
} as const;

const contentEntrySummarySelection = {
  contentLocales: {
    orderBy: { localeId: "asc" },
    select: {
      locale: { select: { code: true } },
      localeId: true,
      revision: true,
      updatedAt: true,
    },
  },
  contentType: { select: { displayName: true, id: true, key: true } },
  contentTypeId: true,
  createdAt: true,
  id: true,
  publishedAt: true,
  revision: true,
  schemaVersion: true,
  status: true,
  updatedAt: true,
} as const;

const contentEntryDetailSelection = {
  ...contentEntrySummarySelection,
  contentLocales: {
    orderBy: { localeId: "asc" },
    select: {
      createdAt: true,
      data: true,
      id: true,
      locale: { select: { code: true } },
      localeId: true,
      revision: true,
      schemaVersion: true,
      updatedAt: true,
    },
  },
} as const;

export type ContentPageInput = {
  contentTypeId?: string;
  cursor?: string;
  limit?: string;
};

export class InvalidContentInputError extends Error {
  override readonly name = "InvalidContentInputError";

  constructor() {
    super("Content administration input is invalid.");
  }
}

export class InvalidContentPageError extends Error {
  override readonly name = "InvalidContentPageError";

  constructor() {
    super("Content pagination parameters are invalid.");
  }
}

export class ContentTypeNotFoundError extends Error {
  override readonly name = "ContentTypeNotFoundError";

  constructor() {
    super("Content type was not found.");
  }
}

export class ContentTypeConflictError extends Error {
  override readonly name = "ContentTypeConflictError";

  constructor() {
    super("A content type with this key already exists in the site.");
  }
}

export class ContentTypeInUseError extends Error {
  override readonly name = "ContentTypeInUseError";

  constructor() {
    super("Content type cannot be deleted while entries use it.");
  }
}

export class ContentEntryNotFoundError extends Error {
  override readonly name = "ContentEntryNotFoundError";

  constructor() {
    super("Content entry was not found.");
  }
}

export class ContentPreconditionFailedError extends Error {
  override readonly name = "ContentPreconditionFailedError";

  constructor() {
    super("Content version precondition failed.");
  }
}

export class ContentEntryStateConflictError extends Error {
  override readonly name = "ContentEntryStateConflictError";

  constructor() {
    super("The requested content workflow transition is not allowed.");
  }
}

export class ContentEntryTransitionForbiddenError extends Error {
  override readonly name = "ContentEntryTransitionForbiddenError";

  constructor() {
    super("Content workflow transition is not permitted for this site access.");
  }
}

function isPrismaError(error: unknown, code: string) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

function parsePage(input: ContentPageInput) {
  const rawLimit = input.limit ?? String(defaultPageSize);
  if (!/^[1-9][0-9]{0,2}$/u.test(rawLimit)) {
    throw new InvalidContentPageError();
  }
  const limit = Number(rawLimit);
  if (limit > maximumPageSize || (input.cursor && !uuidPattern.test(input.cursor))) {
    throw new InvalidContentPageError();
  }
  if (input.contentTypeId && !uuidPattern.test(input.contentTypeId)) {
    throw new InvalidContentPageError();
  }
  return { contentTypeId: input.contentTypeId, cursor: input.cursor, limit };
}

function parseContentTypeCreate(input: unknown): ContentTypeCreateInput {
  const result = contentTypeCreateSchema.safeParse(input);
  if (!result.success) {
    throw new InvalidContentInputError();
  }
  return result.data;
}

function parseContentTypeUpdate(input: unknown): ContentTypeUpdateInput {
  const result = contentTypeUpdateSchema.safeParse(input);
  if (!result.success) {
    throw new InvalidContentInputError();
  }
  return result.data;
}

function parseContentEntryCreate(input: unknown): ContentEntryCreateInput {
  const result = contentEntryCreateSchema.safeParse(input);
  if (!result.success) {
    throw new InvalidContentInputError();
  }
  return result.data;
}

function parseContentEntryUpdate(input: unknown): ContentEntryUpdateInput {
  const result = contentEntryUpdateSchema.safeParse(input);
  if (!result.success) {
    throw new InvalidContentInputError();
  }
  return result.data;
}

function parseContentEntryStatusUpdate(input: unknown): ContentEntryStatusUpdateInput {
  const result = contentEntryStatusUpdateSchema.safeParse(input);
  if (!result.success) {
    throw new InvalidContentInputError();
  }
  return result.data;
}

function asJsonValue(value: unknown) {
  return value as Prisma.InputJsonValue;
}

function fieldWrites(fields: ContentTypeCreateInput["fields"]) {
  return fields.map((field) => ({
    config: asJsonValue(field.config),
    fieldType: field.fieldType,
    key: field.key,
    label: field.label,
    position: field.position,
    required: field.required,
  }));
}

function schemaDefinition(
  key: string,
  version: number,
  command: Pick<ContentTypeCreateInput, "displayName" | "fields">,
) {
  return {
    displayName: command.displayName,
    fields: command.fields,
    key,
    version,
  };
}

@Injectable()
export class ContentAdminService {
  constructor(
    @InjectPrismaClient() private readonly prisma: PrismaClient,
    @Inject(ContentFieldValidator) private readonly validator: ContentFieldValidator,
    @Inject(ContentMetrics) private readonly metrics: ContentMetrics,
  ) {}

  async listContentTypes(siteId: string, input: ContentPageInput) {
    const page = parsePage(input);
    if (page.cursor) {
      const cursor = await this.prisma.contentType.findFirst({
        select: { id: true },
        where: { id: page.cursor, siteId },
      });
      if (!cursor) {
        throw new InvalidContentPageError();
      }
    }

    const records = await this.prisma.contentType.findMany({
      cursor: page.cursor ? { id: page.cursor } : undefined,
      orderBy: { id: "asc" },
      select: contentTypeSummarySelection,
      skip: page.cursor ? 1 : 0,
      take: page.limit + 1,
      where: { siteId },
    });
    const hasNextPage = records.length > page.limit;
    const items = hasNextPage ? records.slice(0, page.limit) : records;
    return { items, nextCursor: hasNextPage ? items.at(-1)?.id : undefined };
  }

  async getContentType(siteId: string, contentTypeId: string) {
    const contentType = await this.prisma.contentType.findUnique({
      select: contentTypeDetailSelection,
      where: { id_siteId: { id: contentTypeId, siteId } },
    });
    if (!contentType) {
      throw new ContentTypeNotFoundError();
    }
    return contentType;
  }

  async createContentType(actorId: string, siteId: string, input: unknown) {
    const command = parseContentTypeCreate(input);
    const definition = schemaDefinition(command.key, 1, command);

    try {
      return await this.prisma.$transaction(async (transaction) => {
        const contentType = await transaction.contentType.create({
          data: {
            displayName: command.displayName,
            fields: { create: fieldWrites(command.fields) },
            key: command.key,
            siteId,
          },
          select: contentTypeDetailSelection,
        });
        await transaction.contentTypeSchemaVersion.create({
          data: {
            contentTypeId: contentType.id,
            definition: asJsonValue(definition),
            siteId,
            version: 1,
          },
        });
        await transaction.auditEvent.create({
          data: {
            action: "content.type.created",
            actorId,
            entity: "ContentType",
            entityId: contentType.id,
            metadata: { fieldCount: command.fields.length, key: command.key, siteId, version: 1 },
          },
        });
        return contentType;
      });
    } catch (error) {
      if (isPrismaError(error, "P2002")) {
        throw new ContentTypeConflictError();
      }
      throw error;
    }
  }

  async updateContentType(
    actorId: string,
    siteId: string,
    contentTypeId: string,
    expectedVersion: number,
    input: unknown,
  ) {
    const command = parseContentTypeUpdate(input);

    return this.prisma.$transaction(async (transaction) => {
      const current = await transaction.contentType.findUnique({
        select: { id: true, key: true, schemaVersion: true },
        where: { id_siteId: { id: contentTypeId, siteId } },
      });
      if (!current) {
        throw new ContentTypeNotFoundError();
      }
      if (current.schemaVersion !== expectedVersion) {
        this.preconditionFailed();
      }
      const version = expectedVersion + 1;
      const claimed = await transaction.contentType.updateMany({
        data: { displayName: command.displayName, schemaVersion: version },
        where: { id: contentTypeId, schemaVersion: expectedVersion, siteId },
      });
      if (claimed.count !== 1) {
        this.preconditionFailed();
      }
      const definition = schemaDefinition(current.key, version, command);

      await transaction.fieldDefinition.deleteMany({ where: { contentTypeId } });
      const contentType = await transaction.contentType.update({
        data: { fields: { create: fieldWrites(command.fields) } },
        select: contentTypeDetailSelection,
        where: { id_siteId: { id: contentTypeId, siteId } },
      });
      await transaction.contentTypeSchemaVersion.create({
        data: {
          contentTypeId,
          definition: asJsonValue(definition),
          siteId,
          version,
        },
      });
      await transaction.auditEvent.create({
        data: {
          action: "content.type.updated",
          actorId,
          entity: "ContentType",
          entityId: contentTypeId,
          metadata: {
            fieldCount: command.fields.length,
            previousVersion: expectedVersion,
            siteId,
            version,
          },
        },
      });
      return contentType;
    });
  }

  async deleteContentType(
    actorId: string,
    siteId: string,
    contentTypeId: string,
    expectedVersion: number,
  ) {
    try {
      await this.prisma.$transaction(async (transaction) => {
        const current = await transaction.contentType.findUnique({
          select: { id: true, key: true, schemaVersion: true },
          where: { id_siteId: { id: contentTypeId, siteId } },
        });
        if (!current) {
          throw new ContentTypeNotFoundError();
        }
        if (current.schemaVersion !== expectedVersion) {
          this.preconditionFailed();
        }
        const deleted = await transaction.contentType.deleteMany({
          where: { id: contentTypeId, schemaVersion: expectedVersion, siteId },
        });
        if (deleted.count !== 1) {
          this.preconditionFailed();
        }
        await transaction.auditEvent.create({
          data: {
            action: "content.type.deleted",
            actorId,
            entity: "ContentType",
            entityId: contentTypeId,
            metadata: { key: current.key, siteId, version: current.schemaVersion },
          },
        });
      });
    } catch (error) {
      if (isPrismaError(error, "P2003")) {
        throw new ContentTypeInUseError();
      }
      throw error;
    }
  }

  async listContentEntries(siteId: string, input: ContentPageInput) {
    const page = parsePage(input);
    const scope = { contentTypeId: page.contentTypeId, siteId };
    if (page.cursor) {
      const cursor = await this.prisma.contentEntry.findFirst({
        select: { id: true },
        where: { ...scope, id: page.cursor },
      });
      if (!cursor) {
        throw new InvalidContentPageError();
      }
    }

    const records = await this.prisma.contentEntry.findMany({
      cursor: page.cursor ? { id: page.cursor } : undefined,
      orderBy: { id: "asc" },
      select: contentEntrySummarySelection,
      skip: page.cursor ? 1 : 0,
      take: page.limit + 1,
      where: scope,
    });
    const hasNextPage = records.length > page.limit;
    const items = hasNextPage ? records.slice(0, page.limit) : records;
    return { items, nextCursor: hasNextPage ? items.at(-1)?.id : undefined };
  }

  async getContentEntry(siteId: string, contentEntryId: string) {
    const entry = await this.prisma.contentEntry.findUnique({
      select: contentEntryDetailSelection,
      where: { id_siteId: { id: contentEntryId, siteId } },
    });
    if (!entry) {
      throw new ContentEntryNotFoundError();
    }
    return entry;
  }

  async createContentEntry(actorId: string, siteId: string, input: unknown) {
    const command = parseContentEntryCreate(input);

    return this.prisma.$transaction(async (transaction) => {
      const contentType = await transaction.contentType.findUnique({
        select: { id: true, schemaVersion: true },
        where: { id_siteId: { id: command.contentTypeId, siteId } },
      });
      if (!contentType) {
        throw new ContentTypeNotFoundError();
      }
      const schema = await transaction.contentTypeSchemaVersion.findUniqueOrThrow({
        where: {
          contentTypeId_siteId_version: {
            contentTypeId: contentType.id,
            siteId,
            version: contentType.schemaVersion,
          },
        },
      });
      await this.requireLocales(
        transaction,
        siteId,
        command.locales.map(({ localeId }) => localeId),
      );
      const locales = command.locales.map((locale) => ({
        data: asJsonValue(this.validator.validate(schema.definition, locale.data)),
        localeId: locale.localeId,
        schemaVersion: contentType.schemaVersion,
      }));

      const entry = await transaction.contentEntry.create({
        data: {
          contentLocales: { create: locales },
          contentTypeId: contentType.id,
          schemaVersion: contentType.schemaVersion,
          siteId,
        },
        select: contentEntryDetailSelection,
      });
      await transaction.auditEvent.create({
        data: {
          action: "content.entry.created",
          actorId,
          entity: "ContentEntry",
          entityId: entry.id,
          metadata: {
            contentTypeId: contentType.id,
            localeCount: locales.length,
            schemaVersion: contentType.schemaVersion,
            siteId,
          },
        },
      });
      return entry;
    });
  }

  async updateContentEntry(
    actorId: string,
    siteId: string,
    contentEntryId: string,
    expectedRevision: number,
    input: unknown,
  ) {
    const command = parseContentEntryUpdate(input);

    return this.prisma.$transaction(async (transaction) => {
      const current = await transaction.contentEntry.findUnique({
        select: {
          contentTypeId: true,
          id: true,
          revision: true,
          schemaVersion: true,
          status: true,
        },
        where: { id_siteId: { id: contentEntryId, siteId } },
      });
      if (!current) {
        throw new ContentEntryNotFoundError();
      }
      if (current.revision !== expectedRevision) {
        this.preconditionFailed();
      }
      if (current.status !== "DRAFT") {
        throw new ContentEntryStateConflictError();
      }
      const schema = await transaction.contentTypeSchemaVersion.findUniqueOrThrow({
        where: {
          contentTypeId_siteId_version: {
            contentTypeId: current.contentTypeId,
            siteId,
            version: current.schemaVersion,
          },
        },
      });
      const localeIds = command.locales.map(({ localeId }) => localeId);
      await this.requireLocales(transaction, siteId, localeIds);
      const locales = command.locales.map((locale) => ({
        data: asJsonValue(this.validator.validate(schema.definition, locale.data)),
        localeId: locale.localeId,
      }));

      const claimed = await transaction.contentEntry.updateMany({
        data: { revision: { increment: 1 } },
        where: { id: contentEntryId, revision: expectedRevision, siteId, status: "DRAFT" },
      });
      if (claimed.count !== 1) {
        this.preconditionFailed();
      }

      await transaction.contentLocale.deleteMany({
        where: { contentEntryId, localeId: { notIn: localeIds }, siteId },
      });
      for (const locale of locales) {
        await transaction.contentLocale.upsert({
          create: {
            contentEntryId,
            data: locale.data,
            localeId: locale.localeId,
            schemaVersion: current.schemaVersion,
            siteId,
          },
          update: { data: locale.data, revision: { increment: 1 } },
          where: {
            contentEntryId_localeId: { contentEntryId, localeId: locale.localeId },
          },
        });
      }
      const entry = await transaction.contentEntry.findUniqueOrThrow({
        select: contentEntryDetailSelection,
        where: { id_siteId: { id: contentEntryId, siteId } },
      });
      await transaction.auditEvent.create({
        data: {
          action: "content.entry.updated",
          actorId,
          entity: "ContentEntry",
          entityId: contentEntryId,
          metadata: {
            localeCount: locales.length,
            previousRevision: expectedRevision,
            revision: entry.revision,
            schemaVersion: current.schemaVersion,
            siteId,
          },
        },
      });
      return entry;
    });
  }

  async updateContentEntryStatus(
    actorId: string,
    siteId: string,
    access: SiteAccess,
    contentEntryId: string,
    expectedRevision: number,
    input: unknown,
  ) {
    const command = parseContentEntryStatusUpdate(input);
    let transition: ContentEntryWorkflowTransition | undefined;

    const result = await this.prisma.$transaction(async (transaction) => {
      const current = await transaction.contentEntry.findUnique({
        select: { id: true, revision: true, status: true },
        where: { id_siteId: { id: contentEntryId, siteId } },
      });
      if (!current) {
        throw new ContentEntryNotFoundError();
      }
      if (current.revision !== expectedRevision) {
        this.preconditionFailed();
      }
      if (current.status === command.status) {
        if (!canSetContentWorkflowState(access, siteId, current.status, command.status)) {
          throw new ContentEntryTransitionForbiddenError();
        }
        return transaction.contentEntry.findUniqueOrThrow({
          select: contentEntryDetailSelection,
          where: { id_siteId: { id: contentEntryId, siteId } },
        });
      }
      const workflowTransition = findContentEntryWorkflowTransition(current.status, command.status);
      if (!workflowTransition) {
        throw new ContentEntryStateConflictError();
      }
      if (!canSetContentWorkflowState(access, siteId, current.status, command.status)) {
        throw new ContentEntryTransitionForbiddenError();
      }

      const revision = expectedRevision + 1;
      const changed = await transaction.contentEntry.updateMany({
        data: {
          publishedAt: command.status === "PUBLISHED" ? new Date() : null,
          revision,
          status: command.status,
        },
        where: { id: contentEntryId, revision: expectedRevision, siteId },
      });
      if (changed.count !== 1) {
        this.preconditionFailed();
      }
      const entry = await transaction.contentEntry.findUniqueOrThrow({
        select: contentEntryDetailSelection,
        where: { id_siteId: { id: contentEntryId, siteId } },
      });
      await transaction.auditEvent.create({
        data: {
          action: "content.entry.status.changed",
          actorId,
          entity: "ContentEntry",
          entityId: contentEntryId,
          metadata: {
            from: current.status,
            previousRevision: expectedRevision,
            revision,
            siteId,
            transition: workflowTransition.action,
            to: entry.status,
          },
        },
      });
      transition = workflowTransition;
      return entry;
    });
    if (transition) {
      this.metrics.recordStateTransition(transition.from, transition.to);
    }
    return result;
  }

  async deleteContentEntry(
    actorId: string,
    siteId: string,
    contentEntryId: string,
    expectedRevision: number,
  ) {
    await this.prisma.$transaction(async (transaction) => {
      const current = await transaction.contentEntry.findUnique({
        select: {
          contentTypeId: true,
          id: true,
          revision: true,
          schemaVersion: true,
          status: true,
        },
        where: { id_siteId: { id: contentEntryId, siteId } },
      });
      if (!current) {
        throw new ContentEntryNotFoundError();
      }
      if (current.revision !== expectedRevision) {
        this.preconditionFailed();
      }
      if (current.status !== "DRAFT") {
        throw new ContentEntryStateConflictError();
      }
      const deleted = await transaction.contentEntry.deleteMany({
        where: { id: contentEntryId, revision: expectedRevision, siteId, status: "DRAFT" },
      });
      if (deleted.count !== 1) {
        this.preconditionFailed();
      }
      await transaction.auditEvent.create({
        data: {
          action: "content.entry.deleted",
          actorId,
          entity: "ContentEntry",
          entityId: contentEntryId,
          metadata: {
            contentTypeId: current.contentTypeId,
            revision: current.revision,
            schemaVersion: current.schemaVersion,
            siteId,
          },
        },
      });
    });
  }

  private async requireLocales(
    transaction: Prisma.TransactionClient,
    siteId: string,
    localeIds: string[],
  ) {
    const localeCount = await transaction.locale.count({
      where: { id: { in: localeIds }, siteId },
    });
    if (localeCount !== localeIds.length) {
      throw new InvalidContentInputError();
    }
  }

  private preconditionFailed(): never {
    this.metrics.recordPreconditionFailure();
    throw new ContentPreconditionFailedError();
  }
}
