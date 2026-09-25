import { Inject, Injectable } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  contentPlacementUpdateSchema,
  sectionCreateSchema,
  sectionRoleAssignmentCreateSchema,
  sectionUpdateSchema,
  type ContentPlacementUpdateInput,
  type SectionCreateInput,
  type SectionRoleAssignmentCreateInput,
  type SectionUpdateInput,
} from "@nexora/schemas";
import { InjectPrismaClient } from "../../database/database.module.js";
import { ContentMetrics } from "./content-metrics.js";

const defaultPageSize = 25;
const maximumPageSize = 100;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const sectionSelection = {
  createdAt: true,
  id: true,
  key: true,
  name: true,
  parentId: true,
  updatedAt: true,
} as const;

const placementSelection = {
  contentEntryId: true,
  createdAt: true,
  id: true,
  isPrimary: true,
  isVisible: true,
  position: true,
  sectionId: true,
  updatedAt: true,
} as const;

const roleAssignmentSelection = {
  createdAt: true,
  grantedBy: { select: { displayName: true, id: true } },
  id: true,
  role: { select: { key: true, name: true } },
  user: { select: { displayName: true, id: true } },
} as const;

export type SectionPageInput = {
  cursor?: string;
  limit?: string;
  parentId?: string;
};

export type PlacementPageInput = {
  cursor?: string;
  limit?: string;
  visible?: string;
};

export class InvalidSectionInputError extends Error {
  override readonly name = "InvalidSectionInputError";
  constructor() {
    super("Section input is invalid.");
  }
}

export class InvalidSectionPageError extends Error {
  override readonly name = "InvalidSectionPageError";
  constructor() {
    super("Section pagination parameters are invalid.");
  }
}

export class SectionNotFoundError extends Error {
  override readonly name = "SectionNotFoundError";
  constructor() {
    super("Section was not found.");
  }
}

export class SectionConflictError extends Error {
  override readonly name = "SectionConflictError";
  constructor(message = "Section hierarchy or key conflicts with existing data.") {
    super(message);
  }
}

export class PlacementNotFoundError extends Error {
  override readonly name = "PlacementNotFoundError";
  constructor() {
    super("Content placement was not found.");
  }
}

export class PlacementConflictError extends Error {
  override readonly name = "PlacementConflictError";
  constructor() {
    super("Content placement conflicts with the current primary section.");
  }
}

export class SectionRoleAssignmentNotFoundError extends Error {
  override readonly name = "SectionRoleAssignmentNotFoundError";
  constructor() {
    super("Section role assignment was not found.");
  }
}

export class SectionRoleAssignmentConflictError extends Error {
  override readonly name = "SectionRoleAssignmentConflictError";
  constructor() {
    super("This section role assignment already exists.");
  }
}

export class SectionMemberUnavailableError extends Error {
  override readonly name = "SectionMemberUnavailableError";
  constructor() {
    super("The requested section member is unavailable.");
  }
}

function isPrismaError(error: unknown, code: string) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

function parsePage(input: { cursor?: string; limit?: string }) {
  const rawLimit = input.limit ?? String(defaultPageSize);
  if (!/^[1-9][0-9]{0,2}$/u.test(rawLimit)) {
    throw new InvalidSectionPageError();
  }
  const limit = Number(rawLimit);
  if (limit > maximumPageSize || (input.cursor && !uuidPattern.test(input.cursor))) {
    throw new InvalidSectionPageError();
  }
  return { cursor: input.cursor, limit };
}

function parseSectionCreate(input: unknown): SectionCreateInput {
  const result = sectionCreateSchema.safeParse(input);
  if (!result.success) throw new InvalidSectionInputError();
  return result.data;
}

function parseSectionUpdate(input: unknown): SectionUpdateInput {
  const result = sectionUpdateSchema.safeParse(input);
  if (!result.success) throw new InvalidSectionInputError();
  return result.data;
}

function parsePlacement(input: unknown): ContentPlacementUpdateInput {
  const result = contentPlacementUpdateSchema.safeParse(input);
  if (!result.success) throw new InvalidSectionInputError();
  return result.data;
}

function parseRoleAssignment(input: unknown): SectionRoleAssignmentCreateInput {
  const result = sectionRoleAssignmentCreateSchema.safeParse(input);
  if (!result.success) throw new InvalidSectionInputError();
  return result.data;
}

@Injectable()
export class SectionPlacementService {
  constructor(
    @InjectPrismaClient() private readonly prisma: PrismaClient,
    @Inject(ContentMetrics) private readonly metrics: ContentMetrics,
  ) {}

  async listSections(siteId: string, input: SectionPageInput) {
    const page = parsePage(input);
    let parentId: string | null | undefined;
    if (input.parentId === "root") parentId = null;
    else if (input.parentId === undefined) parentId = undefined;
    else if (uuidPattern.test(input.parentId)) parentId = input.parentId;
    else throw new InvalidSectionPageError();

    if (page.cursor) {
      const cursor = await this.prisma.section.findUnique({
        select: { id: true },
        where: { id_siteId: { id: page.cursor, siteId } },
      });
      if (!cursor) throw new InvalidSectionPageError();
    }

    const records = await this.prisma.section.findMany({
      cursor: page.cursor ? { id: page.cursor } : undefined,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: sectionSelection,
      skip: page.cursor ? 1 : 0,
      take: page.limit + 1,
      where: { parentId, siteId },
    });
    return this.page(records, page.limit);
  }

  async getSection(siteId: string, sectionId: string) {
    const section = await this.prisma.section.findUnique({
      select: sectionSelection,
      where: { id_siteId: { id: sectionId, siteId } },
    });
    if (!section) throw new SectionNotFoundError();
    return section;
  }

  async createSection(actorId: string, siteId: string, input: unknown) {
    const command = parseSectionCreate(input);
    try {
      const section = await this.prisma.$transaction(async (transaction) => {
        if (command.parentId) await this.requireSection(transaction, siteId, command.parentId);
        const created = await transaction.section.create({
          data: { key: command.key, name: command.name, parentId: command.parentId, siteId },
          select: sectionSelection,
        });
        await transaction.auditEvent.create({
          data: {
            action: "section.created",
            actorId,
            entity: "Section",
            entityId: created.id,
            metadata: { key: created.key, parentId: created.parentId, siteId },
          },
        });
        return created;
      });
      this.metrics.recordSectionMutation("section_created");
      return section;
    } catch (error) {
      this.mapSectionWriteError(error);
    }
  }

  async updateSection(actorId: string, siteId: string, sectionId: string, input: unknown) {
    const command = parseSectionUpdate(input);
    try {
      const section = await this.prisma.$transaction(async (transaction) => {
        await this.requireSection(transaction, siteId, sectionId);
        if (command.parentId) await this.requireSection(transaction, siteId, command.parentId);
        const updated = await transaction.section.update({
          data: { name: command.name, parentId: command.parentId },
          select: sectionSelection,
          where: { id_siteId: { id: sectionId, siteId } },
        });
        await transaction.auditEvent.create({
          data: {
            action: "section.updated",
            actorId,
            entity: "Section",
            entityId: sectionId,
            metadata: { parentId: updated.parentId, siteId },
          },
        });
        return updated;
      });
      this.metrics.recordSectionMutation("section_updated");
      return section;
    } catch (error) {
      this.mapSectionWriteError(error);
    }
  }

  async deleteSection(actorId: string, siteId: string, sectionId: string) {
    try {
      await this.prisma.$transaction(async (transaction) => {
        const section = await this.requireSection(transaction, siteId, sectionId);
        await transaction.section.delete({ where: { id_siteId: { id: sectionId, siteId } } });
        await transaction.auditEvent.create({
          data: {
            action: "section.deleted",
            actorId,
            entity: "Section",
            entityId: sectionId,
            metadata: { key: section.key, siteId },
          },
        });
      });
      this.metrics.recordSectionMutation("section_deleted");
    } catch (error) {
      this.mapSectionWriteError(error);
    }
  }

  async listPlacements(siteId: string, sectionId: string, input: PlacementPageInput) {
    const page = parsePage(input);
    const isVisible = input.visible === undefined ? undefined : input.visible === "true";
    if (input.visible !== undefined && input.visible !== "true" && input.visible !== "false") {
      throw new InvalidSectionPageError();
    }
    await this.requireSection(this.prisma, siteId, sectionId);
    if (page.cursor) {
      const cursor = await this.prisma.contentPlacement.findFirst({
        select: { id: true },
        where: { id: page.cursor, sectionId, siteId },
      });
      if (!cursor) throw new InvalidSectionPageError();
    }
    const records = await this.prisma.contentPlacement.findMany({
      cursor: page.cursor ? { id: page.cursor } : undefined,
      orderBy: [{ position: "asc" }, { id: "asc" }],
      select: placementSelection,
      skip: page.cursor ? 1 : 0,
      take: page.limit + 1,
      where: { isVisible, sectionId, siteId },
    });
    return this.page(records, page.limit);
  }

  async putPlacement(
    actorId: string,
    siteId: string,
    sectionId: string,
    contentEntryId: string,
    input: unknown,
  ) {
    const command = parsePlacement(input);
    try {
      const placement = await this.prisma.$transaction(async (transaction) => {
        await Promise.all([
          this.requireSection(transaction, siteId, sectionId),
          this.requireContentEntry(transaction, siteId, contentEntryId),
        ]);
        const otherPrimary = await transaction.contentPlacement.findFirst({
          select: { id: true },
          where: { contentEntryId, isPrimary: true, sectionId: { not: sectionId }, siteId },
        });
        const isPrimary = command.isPrimary || !otherPrimary;
        if (isPrimary) {
          await transaction.contentPlacement.updateMany({
            data: { isPrimary: false },
            where: { contentEntryId, isPrimary: true, siteId },
          });
        }
        const saved = await transaction.contentPlacement.upsert({
          create: {
            contentEntryId,
            isPrimary,
            isVisible: command.isVisible,
            position: command.position,
            sectionId,
            siteId,
          },
          select: placementSelection,
          update: { isPrimary, isVisible: command.isVisible, position: command.position },
          where: { sectionId_contentEntryId: { contentEntryId, sectionId } },
        });
        await transaction.auditEvent.create({
          data: {
            action: "content.placement.saved",
            actorId,
            entity: "ContentPlacement",
            entityId: saved.id,
            metadata: {
              contentEntryId,
              isPrimary,
              isVisible: command.isVisible,
              position: command.position,
              sectionId,
              siteId,
            },
          },
        });
        return saved;
      });
      this.metrics.recordSectionMutation("placement_saved");
      return placement;
    } catch (error) {
      if (isPrismaError(error, "P2002")) throw new PlacementConflictError();
      throw error;
    }
  }

  async deletePlacement(
    actorId: string,
    siteId: string,
    sectionId: string,
    contentEntryId: string,
  ) {
    await this.prisma.$transaction(async (transaction) => {
      const placement = await transaction.contentPlacement.findFirst({
        select: { id: true, isPrimary: true },
        where: { contentEntryId, sectionId, siteId },
      });
      if (!placement) throw new PlacementNotFoundError();
      await transaction.contentPlacement.delete({ where: { id: placement.id } });
      if (placement.isPrimary) {
        const replacement = await transaction.contentPlacement.findFirst({
          orderBy: [{ position: "asc" }, { id: "asc" }],
          select: { id: true },
          where: { contentEntryId, siteId },
        });
        if (replacement) {
          await transaction.contentPlacement.update({
            data: { isPrimary: true },
            where: { id: replacement.id },
          });
        }
      }
      await transaction.auditEvent.create({
        data: {
          action: "content.placement.deleted",
          actorId,
          entity: "ContentPlacement",
          entityId: placement.id,
          metadata: { contentEntryId, sectionId, siteId },
        },
      });
    });
    this.metrics.recordSectionMutation("placement_deleted");
  }

  async listRoleAssignments(siteId: string, sectionId: string, input: SectionPageInput) {
    const page = parsePage(input);
    await this.requireSection(this.prisma, siteId, sectionId);
    if (page.cursor) {
      const cursor = await this.prisma.sectionRoleAssignment.findFirst({
        select: { id: true },
        where: { id: page.cursor, sectionId, siteId },
      });
      if (!cursor) throw new InvalidSectionPageError();
    }
    const records = await this.prisma.sectionRoleAssignment.findMany({
      cursor: page.cursor ? { id: page.cursor } : undefined,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: roleAssignmentSelection,
      skip: page.cursor ? 1 : 0,
      take: page.limit + 1,
      where: { sectionId, siteId },
    });
    return this.page(records, page.limit);
  }

  async createRoleAssignment(actorId: string, siteId: string, sectionId: string, input: unknown) {
    const command = parseRoleAssignment(input);
    try {
      const assignment = await this.prisma.$transaction(async (transaction) => {
        await this.requireSection(transaction, siteId, sectionId);
        const user = await transaction.user.findFirst({
          select: { id: true },
          where: { id: command.userId, status: "ACTIVE" },
        });
        if (!user) throw new SectionMemberUnavailableError();
        const created = await transaction.sectionRoleAssignment.create({
          data: {
            grantedById: actorId,
            roleKey: command.roleKey,
            sectionId,
            siteId,
            userId: user.id,
          },
          select: roleAssignmentSelection,
        });
        await transaction.auditEvent.create({
          data: {
            action: "section.role-assignment.created",
            actorId,
            entity: "SectionRoleAssignment",
            entityId: created.id,
            metadata: { roleKey: command.roleKey, sectionId, siteId, userId: user.id },
          },
        });
        return created;
      });
      this.metrics.recordSectionMutation("role_granted");
      return assignment;
    } catch (error) {
      if (isPrismaError(error, "P2002")) throw new SectionRoleAssignmentConflictError();
      throw error;
    }
  }

  async deleteRoleAssignment(
    actorId: string,
    siteId: string,
    sectionId: string,
    assignmentId: string,
  ) {
    await this.prisma.$transaction(async (transaction) => {
      const assignment = await transaction.sectionRoleAssignment.findFirst({
        select: { id: true, roleKey: true, userId: true },
        where: { id: assignmentId, sectionId, siteId },
      });
      if (!assignment) throw new SectionRoleAssignmentNotFoundError();
      await transaction.sectionRoleAssignment.delete({ where: { id: assignment.id } });
      await transaction.auditEvent.create({
        data: {
          action: "section.role-assignment.deleted",
          actorId,
          entity: "SectionRoleAssignment",
          entityId: assignment.id,
          metadata: { roleKey: assignment.roleKey, sectionId, siteId, userId: assignment.userId },
        },
      });
    });
    this.metrics.recordSectionMutation("role_revoked");
  }

  private async requireSection(
    client: Pick<PrismaClient, "section"> | Prisma.TransactionClient,
    siteId: string,
    sectionId: string,
  ) {
    const section = await client.section.findUnique({
      select: { id: true, key: true },
      where: { id_siteId: { id: sectionId, siteId } },
    });
    if (!section) throw new SectionNotFoundError();
    return section;
  }

  private async requireContentEntry(
    client: Pick<PrismaClient, "contentEntry"> | Prisma.TransactionClient,
    siteId: string,
    contentEntryId: string,
  ) {
    const entry = await client.contentEntry.findUnique({
      select: { id: true },
      where: { id_siteId: { id: contentEntryId, siteId } },
    });
    if (!entry) throw new PlacementNotFoundError();
    return entry;
  }

  private mapSectionWriteError(error: unknown): never {
    if (
      isPrismaError(error, "P2002") ||
      isPrismaError(error, "P2003") ||
      isPrismaError(error, "P2039")
    ) {
      throw new SectionConflictError();
    }
    throw error;
  }

  private page<Record extends { id: string }>(records: Record[], limit: number) {
    const hasNextPage = records.length > limit;
    const items = hasNextPage ? records.slice(0, limit) : records;
    return { items, nextCursor: hasNextPage ? items.at(-1)?.id : undefined };
  }
}
