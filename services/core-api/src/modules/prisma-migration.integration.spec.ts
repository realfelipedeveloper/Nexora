import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { platform } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Test } from "@nestjs/testing";
import type { INestApplication, LoggerService } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Client } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PRISMA_CLIENT } from "../database/database.module.js";
import { createPrismaClient } from "../database/prisma-client.js";
import {
  ContentEntriesController,
  ContentTypesController,
} from "./content/content-admin.controller.js";
import { ContentAdminService } from "./content/content-admin.service.js";
import { ContentCollaborationController } from "./content/content-collaboration.controller.js";
import { ContentCollaborationService } from "./content/content-collaboration.service.js";
import { ContentFieldValidator } from "./content/content-field-validator.js";
import { ContentMetrics } from "./content/content-metrics.js";
import { PublicContentController } from "./content/content-public.controller.js";
import { PublicContentService } from "./content/content-public.service.js";
import { configureHttpSecurity } from "./http-security.js";
import {
  AdminAlreadyProvisionedError,
  provisionInitialAdmin,
} from "./identity/admin-provisioning.js";
import { SessionCsrfGuard, SystemAdministratorGuard } from "./identity/administrative-guards.js";
import { hashPassword } from "./identity/credentials.js";
import { IDENTITY_CONFIGURATION } from "./identity/identity.config.js";
import { IdentityController } from "./identity/identity.controller.js";
import { IdentityService } from "./identity/identity.service.js";
import { SessionAuthenticationGuard } from "./identity/session-authentication.guard.js";
import { sessionCookieName } from "./identity/session-security.js";
import { hashSessionToken } from "./identity/session-token.js";
import { SiteAccessController } from "./identity/site-access.controller.js";
import { SiteAccessService } from "./identity/site-access.service.js";
import { SiteAuthorizationGuard } from "./identity/site-authorization.guard.js";
import { ConfigurationRegistry } from "./sites/configuration-registry.js";
import {
  GlobalSettingsController,
  SiteSettingsController,
} from "./sites/configuration-settings.controller.js";
import { ConfigurationSettingsService } from "./sites/configuration-settings.service.js";
import { PublicConfigurationController } from "./sites/public-configuration.controller.js";
import { PublicConfigurationService } from "./sites/public-configuration.service.js";
import { SiteLifecycleService } from "./sites/site-lifecycle.service.js";
import { SitesController } from "./sites/sites.controller.js";

const execFileAsync = promisify(execFile);
const workspaceRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const migrationsRoot = path.join(workspaceRoot, "services", "core-api", "prisma", "migrations");
const contentSchemaVersioningMigration = "20260917180000_content_schema_versioning";
const contentEditorialStateMigration = "20260922143000_content_entry_editorial_state";
const editorialWorkflowModelMigration = "20260922223000_editorial_workflow_model";

async function applyMigrationsBeforeContentSchemaVersioning(connectionString: string) {
  const client = new Client({ connectionString });
  const migrationDirectories = (await readdir(migrationsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name < contentSchemaVersioningMigration)
    .map((entry) => entry.name)
    .sort();

  await client.connect();
  try {
    for (const migrationDirectory of migrationDirectories) {
      const migration = await readFile(
        path.join(migrationsRoot, migrationDirectory, "migration.sql"),
        "utf8",
      );
      await client.query(migration);
    }
  } finally {
    await client.end();
  }
}

async function applyContentSchemaVersioningMigration(connectionString: string) {
  const client = new Client({ connectionString });
  const migration = await readFile(
    path.join(migrationsRoot, contentSchemaVersioningMigration, "migration.sql"),
    "utf8",
  );

  await client.connect();
  try {
    await client.query(migration);
  } finally {
    await client.end();
  }
}

async function applyContentEditorialStateMigration(connectionString: string) {
  const client = new Client({ connectionString });
  const migration = await readFile(
    path.join(migrationsRoot, contentEditorialStateMigration, "migration.sql"),
    "utf8",
  );

  await client.connect();
  try {
    await client.query(migration);
  } finally {
    await client.end();
  }
}

async function applyEditorialWorkflowModelMigration(connectionString: string) {
  const client = new Client({ connectionString });
  const migration = await readFile(
    path.join(migrationsRoot, editorialWorkflowModelMigration, "migration.sql"),
    "utf8",
  );

  await client.connect();
  try {
    await client.query(migration);
  } finally {
    await client.end();
  }
}

class CapturedLogger implements LoggerService {
  readonly entries: unknown[] = [];

  debug(...messages: unknown[]) {
    this.entries.push(...messages);
  }

  error(...messages: unknown[]) {
    this.entries.push(...messages);
  }

  fatal(...messages: unknown[]) {
    this.entries.push(...messages);
  }

  log(...messages: unknown[]) {
    this.entries.push(...messages);
  }

  verbose(...messages: unknown[]) {
    this.entries.push(...messages);
  }

  warn(...messages: unknown[]) {
    this.entries.push(...messages);
  }
}

describe("PostgreSQL migrations and integration", () => {
  let postgres: StartedPostgreSqlContainer;

  beforeAll(async () => {
    process.env.TESTCONTAINERS_RYUK_DISABLED = "true";

    postgres = await new PostgreSqlContainer("postgres:17-alpine")
      .withDatabase("nexora_test")
      .withUsername("nexora")
      .withPassword("nexora_test_password")
      .start();
  }, 300_000);

  afterAll(async () => {
    await postgres?.stop();
  });

  it("applies the baseline schema to a clean PostgreSQL container", async () => {
    const isWindows = platform() === "win32";
    const packageManager = isWindows ? "cmd.exe" : "pnpm";
    const packageManagerArgs = isWindows
      ? ["/d", "/s", "/c", "pnpm --filter @nexora/core-api prisma:migrate"]
      : ["--filter", "@nexora/core-api", "prisma:migrate"];

    await execFileAsync(packageManager, packageManagerArgs, {
      cwd: workspaceRoot,
      env: {
        ...process.env,
        DATABASE_URL: postgres.getConnectionUri(),
      },
    });

    const tableList = await postgres.exec([
      "sh",
      "-lc",
      [
        "PGPASSWORD=nexora_test_password",
        "psql",
        "-U nexora",
        "-d nexora_test",
        "-tAc",
        "\"SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;\"",
      ].join(" "),
    ]);

    expect(tableList.exitCode).toBe(0);
    expect(tableList.output.split(/\s+/).filter(Boolean)).toEqual(
      expect.arrayContaining([
        "AuditEvent",
        "ContentEntry",
        "ContentLocale",
        "ContentType",
        "ContentTypeSchemaVersion",
        "FieldDefinition",
        "GlobalSetting",
        "Locale",
        "Permission",
        "Role",
        "RolePermission",
        "Session",
        "Site",
        "SiteRoleAssignment",
        "SiteSetting",
        "User",
        "_prisma_migrations",
      ]),
    );

    const identityConstraints = await postgres.exec([
      "sh",
      "-lc",
      [
        "PGPASSWORD=nexora_test_password",
        "psql",
        "-U nexora",
        "-d nexora_test",
        "-tAc",
        "\"SELECT conname FROM pg_constraint WHERE conname IN ('Session_expiry_after_creation_check', 'Session_userId_fkey') ORDER BY conname;\"",
      ].join(" "),
    ]);

    expect(identityConstraints.exitCode).toBe(0);
    expect(identityConstraints.output.split(/\s+/).filter(Boolean)).toEqual([
      "Session_expiry_after_creation_check",
      "Session_userId_fkey",
    ]);

    const publicContentIndex = await postgres.exec([
      "sh",
      "-lc",
      [
        "PGPASSWORD=nexora_test_password",
        "psql",
        "-U nexora",
        "-d nexora_test",
        "-tAc",
        `"SELECT indexname FROM pg_indexes WHERE indexname = 'ContentEntry_siteId_contentTypeId_status_publishedAt_id_idx';"`,
      ].join(" "),
    ]);
    expect(publicContentIndex.exitCode).toBe(0);
    expect(publicContentIndex.output.trim()).toBe(
      "ContentEntry_siteId_contentTypeId_status_publishedAt_id_idx",
    );

    const insertUser = await postgres.exec([
      "sh",
      "-lc",
      [
        "PGPASSWORD=nexora_test_password",
        "psql",
        "-v ON_ERROR_STOP=1",
        "-U nexora",
        "-d nexora_test",
        "-tAc",
        `"INSERT INTO \\"User\\" (\\"id\\", \\"email\\", \\"normalizedEmail\\", \\"displayName\\", \\"passwordHash\\", \\"updatedAt\\") VALUES ('user-1', 'Admin@example.com', 'admin@example.com', 'Admin', 'argon2id-hash', CURRENT_TIMESTAMP);"`,
      ].join(" "),
    ]);

    expect(insertUser.exitCode).toBe(0);

    const duplicateEmail = await postgres.exec([
      "sh",
      "-lc",
      [
        "PGPASSWORD=nexora_test_password",
        "psql",
        "-v ON_ERROR_STOP=1",
        "-U nexora",
        "-d nexora_test",
        "-tAc",
        `"INSERT INTO \\"User\\" (\\"id\\", \\"email\\", \\"normalizedEmail\\", \\"displayName\\", \\"passwordHash\\", \\"updatedAt\\") VALUES ('user-2', 'ADMIN@example.com', 'admin@example.com', 'Duplicate', 'argon2id-hash', CURRENT_TIMESTAMP);"`,
      ].join(" "),
    ]);

    expect(duplicateEmail.exitCode).not.toBe(0);

    const expiredSession = await postgres.exec([
      "sh",
      "-lc",
      [
        "PGPASSWORD=nexora_test_password",
        "psql",
        "-v ON_ERROR_STOP=1",
        "-U nexora",
        "-d nexora_test",
        "-tAc",
        `"INSERT INTO \\"Session\\" (\\"id\\", \\"userId\\", \\"tokenHash\\", \\"expiresAt\\") VALUES ('expired-session', 'user-1', 'expired-token-hash', TIMESTAMP '2000-01-01 00:00:00');"`,
      ].join(" "),
    ]);

    expect(expiredSession.exitCode).not.toBe(0);

    const cascadeDelete = await postgres.exec([
      "sh",
      "-lc",
      [
        "PGPASSWORD=nexora_test_password",
        "psql",
        "-v ON_ERROR_STOP=1",
        "-U nexora",
        "-d nexora_test",
        "-tAc",
        `"INSERT INTO \\"Session\\" (\\"id\\", \\"userId\\", \\"tokenHash\\", \\"expiresAt\\") VALUES ('active-session', 'user-1', 'active-token-hash', CURRENT_TIMESTAMP + INTERVAL '1 hour'); DELETE FROM \\"User\\" WHERE \\"id\\" = 'user-1'; SELECT COUNT(*) FROM \\"Session\\" WHERE \\"id\\" = 'active-session';"`,
      ].join(" "),
    ]);

    expect(cascadeDelete.exitCode).toBe(0);
    expect(cascadeDelete.output.split(/\s+/).filter(Boolean).at(-1)).toBe("0");
  }, 120_000);

  it("enforces site lifecycle and configuration persistence invariants", async () => {
    const prisma = createPrismaClient(postgres.getConnectionUri());

    try {
      const site = await prisma.site.create({
        data: { key: "configuration-site", name: "Configuration Site" },
      });
      expect(site.status).toBe("ACTIVE");

      await prisma.locale.create({
        data: { code: "en-US", isDefault: true, siteId: site.id },
      });
      await expect(
        prisma.locale.create({
          data: { code: "pt-BR", isDefault: true, siteId: site.id },
        }),
      ).rejects.toMatchObject({ code: "P2002" });

      await prisma.globalSetting.create({
        data: {
          key: "platform.branding",
          value: { productName: "Nexora" },
        },
      });
      await prisma.siteSetting.create({
        data: {
          key: "site.identity",
          siteId: site.id,
          value: { displayName: "Configuration Site" },
        },
      });

      await expect(
        prisma.site.create({ data: { key: "Invalid Site Key", name: "Invalid" } }),
      ).rejects.toMatchObject({ code: "P2039" });
      await expect(
        prisma.globalSetting.create({
          data: { key: "Invalid Setting Key", value: {} },
        }),
      ).rejects.toMatchObject({ code: "P2039" });
      await expect(
        prisma.siteSetting.create({
          data: {
            key: "site.scalar",
            siteId: site.id,
            value: "not-an-object",
          },
        }),
      ).rejects.toMatchObject({ code: "P2039" });
      await expect(
        prisma.siteSetting.create({
          data: { key: "site.invalidversion", siteId: site.id, value: {}, version: 0 },
        }),
      ).rejects.toMatchObject({ code: "P2039" });

      await prisma.site.update({
        data: { status: "ARCHIVED" },
        where: { id: site.id },
      });
      await expect(
        prisma.site.findUniqueOrThrow({ where: { id: site.id } }),
      ).resolves.toMatchObject({ status: "ARCHIVED" });

      await prisma.site.delete({ where: { id: site.id } });
      await expect(
        prisma.siteSetting.findUnique({
          where: { siteId_key: { key: "site.identity", siteId: site.id } },
        }),
      ).resolves.toBeNull();
      await expect(
        prisma.globalSetting.findUnique({ where: { key: "platform.branding" } }),
      ).resolves.toMatchObject({ version: 1 });
    } finally {
      await prisma.$disconnect();
    }
  }, 120_000);

  it("enforces editorial content persistence invariants and multi-site isolation", async () => {
    const prisma = createPrismaClient(postgres.getConnectionUri());

    try {
      const firstSite = await prisma.site.create({
        data: { key: "content-first", name: "Content First" },
      });
      const secondSite = await prisma.site.create({
        data: { key: "content-second", name: "Content Second" },
      });
      const [firstLocale, secondLocale] = await Promise.all([
        prisma.locale.create({
          data: { code: "pt-BR", isDefault: true, siteId: firstSite.id },
        }),
        prisma.locale.create({
          data: { code: "en-US", isDefault: true, siteId: secondSite.id },
        }),
      ]);
      const [firstType, secondType] = await Promise.all([
        prisma.contentType.create({
          data: {
            displayName: "Institutional Page",
            key: "institutional-page",
            siteId: firstSite.id,
          },
        }),
        prisma.contentType.create({
          data: { displayName: "News Article", key: "news-article", siteId: secondSite.id },
        }),
      ]);

      const field = await prisma.fieldDefinition.create({
        data: {
          contentTypeId: firstType.id,
          fieldType: "richText",
          key: "body",
          label: "Body",
        },
      });
      expect(field.config).toEqual({});

      const firstSchemaVersion = await prisma.contentTypeSchemaVersion.create({
        data: {
          contentTypeId: firstType.id,
          definition: {
            displayName: firstType.displayName,
            fields: [
              {
                config: field.config,
                fieldType: field.fieldType,
                key: field.key,
                label: field.label,
                position: field.position,
                required: field.required,
              },
            ],
            key: firstType.key,
            version: 1,
          },
          siteId: firstSite.id,
          version: 1,
        },
      });

      const entry = await prisma.contentEntry.create({
        data: { contentTypeId: firstType.id, siteId: firstSite.id },
      });
      expect(entry).toMatchObject({
        publishedAt: null,
        revision: 1,
        schemaVersion: 1,
        siteId: firstSite.id,
        status: "DRAFT",
      });
      await expect(
        prisma.contentEntry.update({
          data: { status: "IN_REVIEW" },
          where: { id: entry.id },
        }),
      ).resolves.toMatchObject({ publishedAt: null, status: "IN_REVIEW" });
      await expect(
        prisma.contentEntry.update({
          data: { status: "ARCHIVED" },
          where: { id: entry.id },
        }),
      ).resolves.toMatchObject({ publishedAt: null, status: "ARCHIVED" });
      await prisma.contentEntry.update({
        data: { status: "DRAFT" },
        where: { id: entry.id },
      });
      await expect(
        prisma.contentEntry.update({
          data: { status: "PUBLISHED" },
          where: { id: entry.id },
        }),
      ).rejects.toMatchObject({ code: "P2039" });
      await expect(
        prisma.contentEntry.update({
          data: { publishedAt: new Date() },
          where: { id: entry.id },
        }),
      ).rejects.toMatchObject({ code: "P2039" });

      const contentLocale = await prisma.contentLocale.create({
        data: {
          contentEntryId: entry.id,
          data: { title: "Nexora" },
          localeId: firstLocale.id,
          siteId: firstSite.id,
        },
      });
      expect(contentLocale).toMatchObject({
        data: { title: "Nexora" },
        revision: 1,
        schemaVersion: 1,
      });

      await prisma.contentTypeSchemaVersion.create({
        data: {
          contentTypeId: firstType.id,
          definition: {
            displayName: firstType.displayName,
            fields: [
              {
                config: field.config,
                fieldType: field.fieldType,
                key: field.key,
                label: field.label,
                position: field.position,
                required: field.required,
              },
              {
                config: {},
                fieldType: "text",
                key: "subtitle",
                label: "Subtitle",
                position: 1,
                required: false,
              },
            ],
            key: firstType.key,
            version: 2,
          },
          siteId: firstSite.id,
          version: 2,
        },
      });
      await prisma.contentType.update({
        data: { schemaVersion: 2 },
        where: { id: firstType.id },
      });
      await expect(
        prisma.contentEntry.findUniqueOrThrow({ where: { id: entry.id } }),
      ).resolves.toMatchObject({ schemaVersion: firstSchemaVersion.version });
      await expect(
        prisma.contentTypeSchemaVersion.update({
          data: { definition: { key: "mutated" } },
          where: { id: firstSchemaVersion.id },
        }),
      ).rejects.toMatchObject({ code: "P2039" });

      await expect(
        prisma.contentEntry.create({
          data: { contentTypeId: secondType.id, siteId: firstSite.id },
        }),
      ).rejects.toMatchObject({ code: "P2003" });
      await expect(
        prisma.contentLocale.create({
          data: {
            contentEntryId: entry.id,
            data: { title: "Wrong site" },
            localeId: secondLocale.id,
            siteId: firstSite.id,
          },
        }),
      ).rejects.toMatchObject({ code: "P2003" });
      await expect(
        prisma.contentLocale.create({
          data: {
            contentEntryId: entry.id,
            data: "not-an-object",
            localeId: firstLocale.id,
            siteId: firstSite.id,
          },
        }),
      ).rejects.toMatchObject({ code: "P2039" });
      await expect(
        prisma.fieldDefinition.create({
          data: {
            contentTypeId: firstType.id,
            fieldType: "unsupported",
            key: "invalid-field",
            label: "Invalid field",
          },
        }),
      ).rejects.toMatchObject({ code: "P2039" });
      await expect(
        prisma.contentType.delete({ where: { id: firstType.id } }),
      ).rejects.toMatchObject({
        code: "P2003",
      });
    } finally {
      await prisma.$disconnect();
    }
  }, 120_000);

  it("backfills schema versions and editorial defaults without changing legacy entries", async () => {
    const legacyPostgres = await new PostgreSqlContainer("postgres:17-alpine")
      .withDatabase("nexora_legacy")
      .withUsername("nexora")
      .withPassword("nexora_legacy_password")
      .start();
    const connectionString = legacyPostgres.getConnectionUri();
    const prisma = createPrismaClient(connectionString);

    try {
      await applyMigrationsBeforeContentSchemaVersioning(connectionString);

      const site = await prisma.site.create({
        data: { key: "legacy-content", name: "Legacy Content" },
      });
      const locale = await prisma.locale.create({
        data: { code: "pt-BR", isDefault: true, siteId: site.id },
      });
      const contentType = await prisma.contentType.create({
        data: {
          displayName: "Legacy Page",
          key: "legacy-page",
          siteId: site.id,
        },
      });
      await prisma.fieldDefinition.create({
        data: {
          contentTypeId: contentType.id,
          fieldType: "text",
          key: "title",
          label: "Title",
        },
      });
      const entry = { id: "legacy-content-entry" };
      await prisma.$executeRaw`
        INSERT INTO "ContentEntry" (
          "id", "siteId", "contentTypeId", "schemaVersion", "revision", "createdAt", "updatedAt"
        ) VALUES (
          ${entry.id}, ${site.id}, ${contentType.id}, 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      `;
      const legacyData = { title: "Preserved content" };
      await prisma.contentLocale.create({
        data: {
          contentEntryId: entry.id,
          data: legacyData,
          localeId: locale.id,
          siteId: site.id,
        },
      });

      await applyContentSchemaVersioningMigration(connectionString);
      await applyContentEditorialStateMigration(connectionString);
      await applyEditorialWorkflowModelMigration(connectionString);

      await expect(
        prisma.contentEntry.findUniqueOrThrow({
          include: { contentLocales: true, contentTypeSchemaVersion: true },
          where: { id: entry.id },
        }),
      ).resolves.toMatchObject({
        contentLocales: [{ data: legacyData }],
        contentTypeSchemaVersion: {
          definition: {
            fields: [expect.objectContaining({ key: "title" })],
            key: contentType.key,
            version: 1,
          },
          version: 1,
        },
        publishedAt: null,
        schemaVersion: 1,
        status: "DRAFT",
      });
    } finally {
      await prisma.$disconnect();
      await legacyPostgres.stop();
    }
  }, 120_000);

  it("enforces multi-site administrative content CRUD with audit metadata", async () => {
    const prisma = createPrismaClient(postgres.getConnectionUri());
    const password = "content administration integration password";
    const passwordHash = await hashPassword(password);
    const [viewer, editor, publisher] = await Promise.all([
      prisma.user.create({
        data: {
          displayName: "Content Viewer",
          email: "content.viewer@example.com",
          normalizedEmail: "content.viewer@example.com",
          passwordHash,
        },
      }),
      prisma.user.create({
        data: {
          displayName: "Content Editor",
          email: "content.editor@example.com",
          normalizedEmail: "content.editor@example.com",
          passwordHash,
        },
      }),
      prisma.user.create({
        data: {
          displayName: "Content Publisher",
          email: "content.publisher@example.com",
          normalizedEmail: "content.publisher@example.com",
          passwordHash,
        },
      }),
    ]);
    const [primarySite, secondarySite] = await Promise.all([
      prisma.site.create({ data: { key: "content-admin-primary", name: "Content Admin Primary" } }),
      prisma.site.create({
        data: { key: "content-admin-secondary", name: "Content Admin Secondary" },
      }),
    ]);
    const [primaryLocale, secondaryLocale] = await Promise.all([
      prisma.locale.create({
        data: { code: "pt-BR", isDefault: true, siteId: primarySite.id },
      }),
      prisma.locale.create({
        data: { code: "en-US", isDefault: true, siteId: secondarySite.id },
      }),
    ]);
    await Promise.all([
      prisma.siteRoleAssignment.create({
        data: { roleKey: "viewer", siteId: primarySite.id, userId: viewer.id },
      }),
      prisma.siteRoleAssignment.create({
        data: { roleKey: "editor", siteId: primarySite.id, userId: editor.id },
      }),
      prisma.siteRoleAssignment.create({
        data: { roleKey: "viewer", siteId: secondarySite.id, userId: editor.id },
      }),
      prisma.siteRoleAssignment.create({
        data: { roleKey: "publisher", siteId: primarySite.id, userId: publisher.id },
      }),
    ]);

    const moduleRef = await Test.createTestingModule({
      controllers: [
        ContentCollaborationController,
        ContentEntriesController,
        ContentTypesController,
        IdentityController,
        PublicContentController,
      ],
      providers: [
        ContentAdminService,
        ContentCollaborationService,
        ContentFieldValidator,
        ContentMetrics,
        PublicContentService,
        IdentityService,
        Reflector,
        SessionAuthenticationGuard,
        SessionCsrfGuard,
        SiteAccessService,
        SiteAuthorizationGuard,
        { provide: PRISMA_CLIENT, useValue: prisma },
        {
          provide: IDENTITY_CONFIGURATION,
          useValue: {
            secureCookies: true,
            sessionRotationIntervalMs: 15 * 60 * 1_000,
            sessionTtlMs: 8 * 60 * 60 * 1_000,
          },
        },
      ],
    }).compile();
    const app: INestApplication = moduleRef.createNestApplication();
    configureHttpSecurity(app);
    await app.init();

    try {
      const loginAs = async (email: string) => {
        const login = await request(app.getHttpServer())
          .post("/auth/login")
          .send({ email, password })
          .expect(200);
        const cookies = login.headers["set-cookie"] as unknown as string[];
        return {
          cookie: cookies[0]?.split(";", 1)[0] ?? "",
          csrfToken: login.body.csrfToken as string,
        };
      };
      const viewerSession = await loginAs(viewer.email);
      const { cookie, csrfToken } = await loginAs(editor.email);
      const publisherSession = await loginAs(publisher.email);

      await request(app.getHttpServer()).get(`/sites/${primarySite.id}/content-types`).expect(401);
      const auditCountBeforeViewerWrite = await prisma.auditEvent.count({
        where: { action: { startsWith: "content." } },
      });
      await request(app.getHttpServer())
        .post(`/sites/${primarySite.id}/content-types`)
        .set("Cookie", viewerSession.cookie)
        .set("x-csrf-token", viewerSession.csrfToken)
        .send({ displayName: "Viewer type", fields: [], key: "viewer-type" })
        .expect(403);
      await expect(
        prisma.auditEvent.count({ where: { action: { startsWith: "content." } } }),
      ).resolves.toBe(auditCountBeforeViewerWrite);

      await request(app.getHttpServer())
        .post(`/sites/${primarySite.id}/content-types`)
        .set("Cookie", cookie)
        .send({ displayName: "Article", fields: [], key: "article" })
        .expect(403);

      const createdType = await request(app.getHttpServer())
        .post(`/sites/${primarySite.id}/content-types`)
        .set("Cookie", cookie)
        .set("x-csrf-token", csrfToken)
        .send({
          displayName: "Article",
          fields: [
            {
              config: { maxLength: 120, minLength: 1 },
              fieldType: "text",
              key: "title",
              label: "Title",
              required: true,
            },
          ],
          key: "article",
        })
        .expect(201);
      expect(createdType.headers["cache-control"]).toBe("no-store");
      expect(createdType.headers.etag).toBe('"1"');
      expect(createdType.body).toMatchObject({ key: "article", schemaVersion: 1 });

      await request(app.getHttpServer())
        .get(`/sites/${primarySite.id}/content-types`)
        .set("Cookie", viewerSession.cookie)
        .expect(200);
      await request(app.getHttpServer())
        .get(`/sites/${secondarySite.id}/content-types`)
        .set("Cookie", publisherSession.cookie)
        .expect(403);

      await request(app.getHttpServer())
        .post(`/sites/${secondarySite.id}/content-types`)
        .set("Cookie", cookie)
        .set("x-csrf-token", csrfToken)
        .send({ displayName: "Forbidden", fields: [], key: "forbidden" })
        .expect(403);

      const types = await request(app.getHttpServer())
        .get(`/sites/${primarySite.id}/content-types?limit=1`)
        .set("Cookie", cookie)
        .expect(200);
      expect(types.body.items).toEqual([
        expect.objectContaining({ id: createdType.body.id, key: "article" }),
      ]);

      await request(app.getHttpServer())
        .put(`/sites/${primarySite.id}/content-types/${createdType.body.id as string}`)
        .set("Cookie", cookie)
        .set("x-csrf-token", csrfToken)
        .send({ displayName: "Missing precondition", fields: [] })
        .expect(428);

      const typeCommand = {
        displayName: "Article",
        fields: [
          {
            config: { maxLength: 120, minLength: 1 },
            fieldType: "text",
            key: "title",
            label: "Title",
            required: true,
          },
          { fieldType: "textarea", key: "summary", label: "Summary" },
        ],
      };
      const concurrentTypeWrites = await Promise.all([
        request(app.getHttpServer())
          .put(`/sites/${primarySite.id}/content-types/${createdType.body.id as string}`)
          .set("Cookie", cookie)
          .set("x-csrf-token", csrfToken)
          .set("If-Match", '"1"')
          .send(typeCommand),
        request(app.getHttpServer())
          .put(`/sites/${primarySite.id}/content-types/${createdType.body.id as string}`)
          .set("Cookie", cookie)
          .set("x-csrf-token", csrfToken)
          .set("If-Match", '"1"')
          .send(typeCommand),
      ]);
      expect(concurrentTypeWrites.map(({ status }) => status).sort()).toEqual([200, 412]);
      const updatedType = concurrentTypeWrites.find(({ status }) => status === 200);
      expect(updatedType?.headers.etag).toBe('"2"');
      expect(updatedType?.body).toMatchObject({ schemaVersion: 2 });

      await request(app.getHttpServer())
        .put(`/sites/${primarySite.id}/content-types/${createdType.body.id as string}`)
        .set("Cookie", cookie)
        .set("x-csrf-token", csrfToken)
        .set("If-Match", '"1"')
        .send({
          displayName: "Article",
          fields: [],
        })
        .expect(412);

      await request(app.getHttpServer())
        .post(`/sites/${primarySite.id}/content-entries`)
        .set("Cookie", cookie)
        .set("x-csrf-token", csrfToken)
        .send({
          contentTypeId: createdType.body.id,
          locales: [{ data: { title: 42 }, localeId: primaryLocale.id }],
        })
        .expect(400);
      await request(app.getHttpServer())
        .post(`/sites/${primarySite.id}/content-entries`)
        .set("Cookie", cookie)
        .set("x-csrf-token", csrfToken)
        .send({
          contentTypeId: createdType.body.id,
          locales: [{ data: { title: "Wrong locale" }, localeId: secondaryLocale.id }],
        })
        .expect(400);

      const submittedTitle = "Administrative content";
      const createdEntry = await request(app.getHttpServer())
        .post(`/sites/${primarySite.id}/content-entries`)
        .set("Cookie", cookie)
        .set("x-csrf-token", csrfToken)
        .send({
          contentTypeId: createdType.body.id,
          locales: [{ data: { title: submittedTitle }, localeId: primaryLocale.id }],
        })
        .expect(201);
      expect(createdEntry.headers.etag).toBe('"1"');
      expect(createdEntry.body).toMatchObject({
        publishedAt: null,
        revision: 1,
        schemaVersion: 2,
        status: "DRAFT",
      });
      await request(app.getHttpServer())
        .get(`/sites/${primarySite.id}/content-entries/${createdEntry.body.id as string}`)
        .set("Cookie", viewerSession.cookie)
        .expect(200);

      const collaborationPath = `/sites/${primarySite.id}/content-entries/${createdEntry.body.id as string}`;
      await request(app.getHttpServer())
        .post(`${collaborationPath}/assignments`)
        .set("Cookie", cookie)
        .set("x-csrf-token", csrfToken)
        .send({ assigneeId: editor.id })
        .expect(403);
      await request(app.getHttpServer())
        .post(`${collaborationPath}/comments`)
        .set("Cookie", viewerSession.cookie)
        .set("x-csrf-token", viewerSession.csrfToken)
        .send({ body: "Viewer comment" })
        .expect(403);

      const assignment = await request(app.getHttpServer())
        .post(`${collaborationPath}/assignments`)
        .set("Cookie", publisherSession.cookie)
        .set("x-csrf-token", publisherSession.csrfToken)
        .send({ assigneeId: editor.id })
        .expect(201);
      expect(assignment.body).toMatchObject({
        assignedBy: { id: publisher.id },
        assignee: { id: editor.id },
      });
      await request(app.getHttpServer())
        .post(`${collaborationPath}/assignments`)
        .set("Cookie", publisherSession.cookie)
        .set("x-csrf-token", publisherSession.csrfToken)
        .send({ assigneeId: editor.id })
        .expect(409);
      await request(app.getHttpServer())
        .post(`${collaborationPath}/assignments`)
        .set("Cookie", publisherSession.cookie)
        .set("x-csrf-token", publisherSession.csrfToken)
        .send({ assigneeId: viewer.id })
        .expect(404);

      const listedAssignments = await request(app.getHttpServer())
        .get(`${collaborationPath}/assignments?limit=1`)
        .set("Cookie", viewerSession.cookie)
        .expect(200);
      expect(listedAssignments.body).toEqual({
        items: [expect.objectContaining({ id: assignment.body.id })],
      });

      const firstCommentBody = "Review the institutional title.";
      await request(app.getHttpServer())
        .post(`${collaborationPath}/comments`)
        .set("Cookie", cookie)
        .set("x-csrf-token", csrfToken)
        .send({ body: "   " })
        .expect(400);
      await request(app.getHttpServer())
        .post(`${collaborationPath}/comments`)
        .set("Cookie", cookie)
        .set("x-csrf-token", csrfToken)
        .send({ body: firstCommentBody })
        .expect(201);
      await request(app.getHttpServer())
        .post(`${collaborationPath}/comments`)
        .set("Cookie", publisherSession.cookie)
        .set("x-csrf-token", publisherSession.csrfToken)
        .send({ body: "Ready for the next workflow step." })
        .expect(201);

      const firstCommentPage = await request(app.getHttpServer())
        .get(`${collaborationPath}/comments?limit=1`)
        .set("Cookie", viewerSession.cookie)
        .expect(200);
      expect(firstCommentPage.body.items).toHaveLength(1);
      expect(firstCommentPage.body.nextCursor).toEqual(expect.any(String));
      const secondCommentPage = await request(app.getHttpServer())
        .get(
          `${collaborationPath}/comments?limit=1&cursor=${firstCommentPage.body.nextCursor as string}`,
        )
        .set("Cookie", viewerSession.cookie)
        .expect(200);
      expect(secondCommentPage.body.items).toHaveLength(1);
      expect(secondCommentPage.body).not.toHaveProperty("nextCursor");

      await request(app.getHttpServer())
        .get(
          `/sites/${secondarySite.id}/content-entries/${createdEntry.body.id as string}/comments`,
        )
        .set("Cookie", cookie)
        .expect(404);
      await expect(
        prisma.contentEntryAssignment.create({
          data: {
            assignedById: publisher.id,
            assigneeId: editor.id,
            contentEntryId: createdEntry.body.id as string,
            siteId: secondarySite.id,
          },
        }),
      ).rejects.toMatchObject({ code: "P2003" });

      await request(app.getHttpServer())
        .delete(`${collaborationPath}/assignments/${assignment.body.id as string}`)
        .set("Cookie", cookie)
        .set("x-csrf-token", csrfToken)
        .expect(403);
      await request(app.getHttpServer())
        .delete(`${collaborationPath}/assignments/${assignment.body.id as string}`)
        .set("Cookie", publisherSession.cookie)
        .set("x-csrf-token", publisherSession.csrfToken)
        .expect(204);

      const collaborationAuditEvents = await prisma.auditEvent.findMany({
        orderBy: { createdAt: "asc" },
        select: { action: true, actorId: true, metadata: true },
        where: {
          action: { startsWith: "content.entry." },
          entity: { in: ["ContentEntryAssignment", "ContentEntryComment"] },
          metadata: { path: ["siteId"], equals: primarySite.id },
        },
      });
      expect(collaborationAuditEvents.map(({ action }) => action)).toEqual([
        "content.entry.assignment.created",
        "content.entry.comment.created",
        "content.entry.comment.created",
        "content.entry.assignment.deleted",
      ]);
      expect(JSON.stringify(collaborationAuditEvents)).not.toContain(firstCommentBody);

      await request(app.getHttpServer())
        .get(
          `/public/sites/${primarySite.key}/content/article/${createdEntry.body.id as string}?locale=pt-BR`,
        )
        .expect(404);
      const draftCollection = await request(app.getHttpServer())
        .get(`/public/sites/${primarySite.key}/content/article?locale=pt-BR`)
        .expect(200);
      expect(draftCollection.body).toEqual({ items: [], nextCursor: null });

      await request(app.getHttpServer())
        .get(`/sites/${secondarySite.id}/content-entries/${createdEntry.body.id as string}`)
        .set("Cookie", cookie)
        .expect(404);

      await request(app.getHttpServer())
        .put(`/sites/${primarySite.id}/content-entries/${createdEntry.body.id as string}`)
        .set("Cookie", cookie)
        .set("x-csrf-token", csrfToken)
        .send({ locales: [] })
        .expect(428);

      const entryCommand = {
        locales: [
          {
            data: { summary: "Updated summary", title: submittedTitle },
            localeId: primaryLocale.id,
          },
        ],
      };
      const concurrentEntryWrites = await Promise.all([
        request(app.getHttpServer())
          .put(`/sites/${primarySite.id}/content-entries/${createdEntry.body.id as string}`)
          .set("Cookie", cookie)
          .set("x-csrf-token", csrfToken)
          .set("If-Match", '"1"')
          .send(entryCommand),
        request(app.getHttpServer())
          .put(`/sites/${primarySite.id}/content-entries/${createdEntry.body.id as string}`)
          .set("Cookie", cookie)
          .set("x-csrf-token", csrfToken)
          .set("If-Match", '"1"')
          .send(entryCommand),
      ]);
      expect(concurrentEntryWrites.map(({ status }) => status).sort()).toEqual([200, 412]);
      const updatedEntry = concurrentEntryWrites.find(({ status }) => status === 200);
      expect(updatedEntry?.headers.etag).toBe('"2"');
      expect(updatedEntry?.body).toMatchObject({ revision: 2, schemaVersion: 2 });

      const auditCountBeforeDeniedMutations = await prisma.auditEvent.count({
        where: { entity: "ContentEntry", entityId: createdEntry.body.id as string },
      });
      await request(app.getHttpServer())
        .put(`/sites/${primarySite.id}/content-entries/${createdEntry.body.id as string}`)
        .set("Cookie", viewerSession.cookie)
        .set("x-csrf-token", viewerSession.csrfToken)
        .set("If-Match", '"2"')
        .send(entryCommand)
        .expect(403);
      await request(app.getHttpServer())
        .patch(`/sites/${primarySite.id}/content-entries/${createdEntry.body.id as string}/status`)
        .set("Cookie", viewerSession.cookie)
        .set("x-csrf-token", viewerSession.csrfToken)
        .set("If-Match", '"2"')
        .send({ status: "IN_REVIEW" })
        .expect(403);

      await request(app.getHttpServer())
        .patch(
          `/sites/${secondarySite.id}/content-entries/${createdEntry.body.id as string}/status`,
        )
        .set("Cookie", cookie)
        .set("x-csrf-token", csrfToken)
        .set("If-Match", '"2"')
        .send({ status: "IN_REVIEW" })
        .expect(404);
      await expect(
        prisma.auditEvent.count({
          where: { entity: "ContentEntry", entityId: createdEntry.body.id as string },
        }),
      ).resolves.toBe(auditCountBeforeDeniedMutations);

      await request(app.getHttpServer())
        .patch(`/sites/${primarySite.id}/content-entries/${createdEntry.body.id as string}/status`)
        .set("Cookie", publisherSession.cookie)
        .set("x-csrf-token", publisherSession.csrfToken)
        .set("If-Match", '"2"')
        .send({ status: "SCHEDULED" })
        .expect(400);

      const auditCountBeforeInvalidTransition = await prisma.auditEvent.count({
        where: { entity: "ContentEntry", entityId: createdEntry.body.id as string },
      });
      await request(app.getHttpServer())
        .patch(`/sites/${primarySite.id}/content-entries/${createdEntry.body.id as string}/status`)
        .set("Cookie", publisherSession.cookie)
        .set("x-csrf-token", publisherSession.csrfToken)
        .set("If-Match", '"2"')
        .send({ status: "PUBLISHED" })
        .expect(409);
      await expect(
        prisma.auditEvent.count({
          where: { entity: "ContentEntry", entityId: createdEntry.body.id as string },
        }),
      ).resolves.toBe(auditCountBeforeInvalidTransition);

      const inReview = await request(app.getHttpServer())
        .patch(`/sites/${primarySite.id}/content-entries/${createdEntry.body.id as string}/status`)
        .set("Cookie", cookie)
        .set("x-csrf-token", csrfToken)
        .set("If-Match", '"2"')
        .send({ status: "IN_REVIEW" })
        .expect(200);
      expect(inReview.headers.etag).toBe('"3"');
      expect(inReview.body).toMatchObject({
        publishedAt: null,
        revision: 3,
        status: "IN_REVIEW",
      });

      const auditCountBeforeEditorPublish = await prisma.auditEvent.count({
        where: { entity: "ContentEntry", entityId: createdEntry.body.id as string },
      });
      await request(app.getHttpServer())
        .patch(`/sites/${primarySite.id}/content-entries/${createdEntry.body.id as string}/status`)
        .set("Cookie", cookie)
        .set("x-csrf-token", csrfToken)
        .set("If-Match", '"3"')
        .send({ status: "PUBLISHED" })
        .expect(403);
      await expect(
        prisma.auditEvent.count({
          where: { entity: "ContentEntry", entityId: createdEntry.body.id as string },
        }),
      ).resolves.toBe(auditCountBeforeEditorPublish);

      const published = await request(app.getHttpServer())
        .patch(`/sites/${primarySite.id}/content-entries/${createdEntry.body.id as string}/status`)
        .set("Cookie", publisherSession.cookie)
        .set("x-csrf-token", publisherSession.csrfToken)
        .set("If-Match", '"3"')
        .send({ status: "PUBLISHED" })
        .expect(200);
      expect(published.headers.etag).toBe('"4"');
      expect(published.body).toMatchObject({ revision: 4, status: "PUBLISHED" });
      expect(published.body.publishedAt).toEqual(expect.any(String));

      const publicDetail = await request(app.getHttpServer())
        .get(
          `/public/sites/${primarySite.key}/content/article/${createdEntry.body.id as string}?locale=pt-BR`,
        )
        .expect(200);
      expect(publicDetail.headers["cache-control"]).toBe(
        "public, max-age=60, s-maxage=300, stale-while-revalidate=60",
      );
      expect(publicDetail.headers.etag).toMatch(/^"sha256-[A-Za-z0-9_-]+"$/u);
      expect(publicDetail.body).toEqual({
        contentType: { key: "article" },
        data: { summary: "Updated summary", title: submittedTitle },
        id: createdEntry.body.id,
        locale: "pt-BR",
        publishedAt: published.body.publishedAt,
        schemaVersion: 2,
        updatedAt: expect.any(String),
      });
      expect(publicDetail.body).not.toHaveProperty("contentTypeId");
      expect(publicDetail.body).not.toHaveProperty("localeId");
      expect(publicDetail.body).not.toHaveProperty("revision");
      expect(publicDetail.body).not.toHaveProperty("siteId");
      expect(publicDetail.body).not.toHaveProperty("status");

      await request(app.getHttpServer())
        .get(
          `/public/sites/${primarySite.key}/content/article/${createdEntry.body.id as string}?locale=pt-BR`,
        )
        .set("If-None-Match", publicDetail.headers.etag as string)
        .expect(304);
      const publicCollection = await request(app.getHttpServer())
        .get(`/public/sites/${primarySite.key}/content/article?locale=pt-BR&limit=1`)
        .expect(200);
      expect(publicCollection.body).toEqual({ items: [publicDetail.body], nextCursor: null });
      await request(app.getHttpServer())
        .get(
          `/public/sites/${secondarySite.key}/content/article/${createdEntry.body.id as string}?locale=en-US`,
        )
        .expect(404);
      await request(app.getHttpServer())
        .get(`/public/sites/${primarySite.key}/content/article`)
        .expect(400);

      const repeatedPublish = await request(app.getHttpServer())
        .patch(`/sites/${primarySite.id}/content-entries/${createdEntry.body.id as string}/status`)
        .set("Cookie", publisherSession.cookie)
        .set("x-csrf-token", publisherSession.csrfToken)
        .set("If-Match", '"4"')
        .send({ status: "PUBLISHED" })
        .expect(200);
      expect(repeatedPublish.headers.etag).toBe('"4"');
      expect(repeatedPublish.body).toMatchObject({
        publishedAt: published.body.publishedAt,
        revision: 4,
        status: "PUBLISHED",
      });

      await request(app.getHttpServer())
        .patch(`/sites/${primarySite.id}/content-entries/${createdEntry.body.id as string}/status`)
        .set("Cookie", publisherSession.cookie)
        .set("x-csrf-token", publisherSession.csrfToken)
        .set("If-Match", '"3"')
        .send({ status: "DRAFT" })
        .expect(412);

      await request(app.getHttpServer())
        .put(`/sites/${primarySite.id}/content-entries/${createdEntry.body.id as string}`)
        .set("Cookie", cookie)
        .set("x-csrf-token", csrfToken)
        .set("If-Match", '"4"')
        .send(entryCommand)
        .expect(409);

      await request(app.getHttpServer())
        .delete(`/sites/${primarySite.id}/content-entries/${createdEntry.body.id as string}`)
        .set("Cookie", cookie)
        .set("x-csrf-token", csrfToken)
        .set("If-Match", '"4"')
        .expect(409);

      const unpublished = await request(app.getHttpServer())
        .patch(`/sites/${primarySite.id}/content-entries/${createdEntry.body.id as string}/status`)
        .set("Cookie", publisherSession.cookie)
        .set("x-csrf-token", publisherSession.csrfToken)
        .set("If-Match", '"4"')
        .send({ status: "DRAFT" })
        .expect(200);
      expect(unpublished.headers.etag).toBe('"5"');
      expect(unpublished.body).toMatchObject({
        publishedAt: null,
        revision: 5,
        status: "DRAFT",
      });

      await request(app.getHttpServer())
        .get(
          `/public/sites/${primarySite.key}/content/article/${createdEntry.body.id as string}?locale=pt-BR`,
        )
        .expect(404);
      const unpublishedCollection = await request(app.getHttpServer())
        .get(`/public/sites/${primarySite.key}/content/article?locale=pt-BR`)
        .expect(200);
      expect(unpublishedCollection.body).toEqual({ items: [], nextCursor: null });

      await request(app.getHttpServer())
        .get(`/sites/${primarySite.id}/content-entries/${createdEntry.body.id as string}`)
        .set("Cookie", cookie)
        .expect(200)
        .expect("ETag", '"5"');

      await request(app.getHttpServer())
        .delete(`/sites/${primarySite.id}/content-types/${createdType.body.id as string}`)
        .set("Cookie", cookie)
        .set("x-csrf-token", csrfToken)
        .set("If-Match", '"2"')
        .expect(409);
      await request(app.getHttpServer())
        .delete(`/sites/${primarySite.id}/content-entries/${createdEntry.body.id as string}`)
        .set("Cookie", cookie)
        .set("x-csrf-token", csrfToken)
        .set("If-Match", '"5"')
        .expect(204);
      await expect(
        prisma.contentEntryComment.count({
          where: { contentEntryId: createdEntry.body.id as string, siteId: primarySite.id },
        }),
      ).resolves.toBe(0);
      await request(app.getHttpServer())
        .delete(`/sites/${primarySite.id}/content-types/${createdType.body.id as string}`)
        .set("Cookie", cookie)
        .set("x-csrf-token", csrfToken)
        .set("If-Match", '"2"')
        .expect(204);

      const auditEvents = await prisma.auditEvent.findMany({
        orderBy: { createdAt: "asc" },
        select: { action: true, actorId: true, metadata: true },
        where: {
          action: {
            in: [
              "content.type.created",
              "content.type.updated",
              "content.entry.created",
              "content.entry.updated",
              "content.entry.status.changed",
              "content.entry.deleted",
              "content.type.deleted",
            ],
          },
          metadata: { path: ["siteId"], equals: primarySite.id },
        },
      });
      expect(auditEvents.map(({ action }) => action)).toEqual([
        "content.type.created",
        "content.type.updated",
        "content.entry.created",
        "content.entry.updated",
        "content.entry.status.changed",
        "content.entry.status.changed",
        "content.entry.status.changed",
        "content.entry.deleted",
        "content.type.deleted",
      ]);
      expect(
        auditEvents
          .filter(({ action }) => action === "content.entry.status.changed")
          .map(({ actorId }) => actorId),
      ).toEqual([editor.id, publisher.id, publisher.id]);
      expect(JSON.stringify(auditEvents)).not.toContain(submittedTitle);

      const metrics = moduleRef.get(ContentMetrics).render();
      expect(metrics).toContain(
        'nexora_content_collaboration_mutations_total{operation="assignment_created"} 1',
      );
      expect(metrics).toContain(
        'nexora_content_collaboration_mutations_total{operation="assignment_deleted"} 1',
      );
      expect(metrics).toContain(
        'nexora_content_collaboration_mutations_total{operation="comment_created"} 2',
      );
      expect(metrics).toContain("nexora_content_precondition_failures_total 4");
      expect(metrics).toContain(
        'nexora_content_state_transitions_total{from="DRAFT",to="IN_REVIEW"} 1',
      );
      expect(metrics).toContain(
        'nexora_content_state_transitions_total{from="IN_REVIEW",to="PUBLISHED"} 1',
      );
      expect(metrics).toContain(
        'nexora_content_state_transitions_total{from="PUBLISHED",to="DRAFT"} 1',
      );
    } finally {
      await app.close();
      await prisma.$disconnect();
    }
  }, 120_000);

  it("enforces seeded roles and isolates editorial access by site", async () => {
    const prisma = createPrismaClient(postgres.getConnectionUri());

    try {
      await expect(prisma.permission.count()).resolves.toBe(10);
      await expect(prisma.role.count()).resolves.toBe(4);
      await expect(prisma.rolePermission.count()).resolves.toBe(24);

      const roleMatrix = await prisma.role.findMany({
        orderBy: { key: "asc" },
        select: {
          key: true,
          permissions: {
            orderBy: { permissionKey: "asc" },
            select: { permissionKey: true },
          },
        },
      });
      expect(
        Object.fromEntries(
          roleMatrix.map((role) => [
            role.key,
            role.permissions.map(({ permissionKey }) => permissionKey),
          ]),
        ),
      ).toEqual({
        editor: ["content.read", "content.write", "media.read", "media.write", "site.read"],
        publisher: [
          "content.publish",
          "content.read",
          "content.write",
          "media.read",
          "media.write",
          "site.read",
        ],
        "site-admin": [
          "content.publish",
          "content.read",
          "content.write",
          "media.read",
          "media.write",
          "members.manage",
          "members.read",
          "settings.read",
          "settings.write",
          "site.read",
        ],
        viewer: ["content.read", "media.read", "site.read"],
      });

      const user = await prisma.user.create({
        data: {
          displayName: "Scoped Editor",
          email: "scoped.editor@example.com",
          normalizedEmail: "scoped.editor@example.com",
          passwordHash: "argon2id-hash",
        },
      });
      const firstSite = await prisma.site.create({
        data: { key: "rbac-first", name: "RBAC First" },
      });
      const secondSite = await prisma.site.create({
        data: { key: "rbac-second", name: "RBAC Second" },
      });
      const assignment = await prisma.siteRoleAssignment.create({
        data: {
          grantedById: user.id,
          roleKey: "editor",
          siteId: firstSite.id,
          userId: user.id,
        },
      });
      const accessService = new SiteAccessService(prisma);

      await expect(accessService.resolveSiteAccess(user.id, false, firstSite.id)).resolves.toEqual({
        isSystemAdmin: false,
        permissionKeys: ["content.read", "content.write", "media.read", "media.write", "site.read"],
        roleKeys: ["editor"],
        siteId: firstSite.id,
      });
      await expect(
        accessService.resolveSiteAccess(user.id, false, secondSite.id),
      ).resolves.toBeUndefined();
      await expect(
        accessService.resolveSiteAccess(user.id, true, secondSite.id),
      ).resolves.toMatchObject({ isSystemAdmin: true, siteId: secondSite.id });
      await expect(
        prisma.siteRoleAssignment.create({
          data: {
            roleKey: "editor",
            siteId: firstSite.id,
            userId: user.id,
          },
        }),
      ).rejects.toMatchObject({ code: "P2002" });

      await prisma.site.delete({ where: { id: firstSite.id } });
      await expect(
        prisma.siteRoleAssignment.findUnique({ where: { id: assignment.id } }),
      ).resolves.toBeNull();
    } finally {
      await prisma.$disconnect();
    }
  }, 120_000);

  it("allows only one concurrent initial administrator with one audit event", async () => {
    const prisma = createPrismaClient(postgres.getConnectionUri());

    try {
      for (let round = 0; round < 5; round += 1) {
        await prisma.auditEvent.deleteMany({
          where: { action: "identity.system_admin.provisioned" },
        });
        await prisma.user.deleteMany({ where: { isSystemAdmin: true } });

        const attempts = await Promise.allSettled([
          provisionInitialAdmin(prisma, {
            displayName: "First Admin",
            email: `first-${round}@example.com`,
            password: "first secure administrator password",
          }),
          provisionInitialAdmin(prisma, {
            displayName: "Second Admin",
            email: `second-${round}@example.com`,
            password: "second secure administrator password",
          }),
        ]);

        expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
        const rejection = attempts.find((attempt) => attempt.status === "rejected");
        expect(rejection).toBeDefined();
        expect((rejection as PromiseRejectedResult).reason).toBeInstanceOf(
          AdminAlreadyProvisionedError,
        );
        await expect(prisma.user.count({ where: { isSystemAdmin: true } })).resolves.toBe(1);
        await expect(
          prisma.auditEvent.count({
            where: { action: "identity.system_admin.provisioned" },
          }),
        ).resolves.toBe(1);
      }
    } finally {
      await prisma.$disconnect();
    }
  }, 120_000);

  it("authenticates and revokes an HTTP session with cookie and CSRF protection", async () => {
    const prisma = createPrismaClient(postgres.getConnectionUri());
    const password = "correct horse battery staple";
    const user = await prisma.user.create({
      data: {
        displayName: "Session Admin",
        email: "Session.Admin@example.com",
        normalizedEmail: "session.admin@example.com",
        passwordHash: await hashPassword(password),
      },
    });
    const allowedSite = await prisma.site.create({
      data: { key: "session-allowed", name: "Session Allowed" },
    });
    const deniedSite = await prisma.site.create({
      data: { key: "session-denied", name: "Session Denied" },
    });
    await prisma.siteRoleAssignment.create({
      data: { roleKey: "viewer", siteId: allowedSite.id, userId: user.id },
    });
    const moduleRef = await Test.createTestingModule({
      controllers: [IdentityController, SiteAccessController],
      providers: [
        IdentityService,
        Reflector,
        SessionAuthenticationGuard,
        SiteAccessService,
        SiteAuthorizationGuard,
        { provide: PRISMA_CLIENT, useValue: prisma },
        {
          provide: IDENTITY_CONFIGURATION,
          useValue: {
            secureCookies: true,
            sessionRotationIntervalMs: 15 * 60 * 1_000,
            sessionTtlMs: 8 * 60 * 60 * 1_000,
          },
        },
      ],
    }).compile();
    const app: INestApplication = moduleRef.createNestApplication();
    configureHttpSecurity(app);
    await app.init();

    try {
      const unknownUser = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ email: "unknown@example.com", password })
        .expect(401);
      const wrongPassword = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ email: user.email, password: "incorrect password value" })
        .expect(401);
      expect(wrongPassword.body).toEqual(unknownUser.body);

      const login = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ email: "  SESSION.ADMIN@example.com ", password })
        .expect(200);
      const setCookies = login.headers["set-cookie"] as unknown as string[];
      const sessionCookie = setCookies[0]?.split(";", 1)[0];
      expect(sessionCookie).toMatch(new RegExp(`^${sessionCookieName}=[A-Za-z0-9_-]{43}$`, "u"));
      expect(setCookies[0]).toContain("HttpOnly");
      expect(setCookies[0]).toContain("SameSite=Strict");
      expect(setCookies[0]).toContain("Path=/");
      expect(setCookies[0]).toContain("Secure");
      expect(login.body).not.toHaveProperty("sessionToken");
      expect(JSON.stringify(login.body)).not.toContain(password);

      const rawSessionToken = sessionCookie?.slice(sessionCookieName.length + 1) ?? "";
      const storedSession = await prisma.session.findUniqueOrThrow({
        where: { tokenHash: hashSessionToken(rawSessionToken) },
      });
      expect(storedSession.tokenHash).not.toBe(rawSessionToken);
      await prisma.session.update({
        data: { lastSeenAt: new Date(Date.now() - 20 * 60 * 1_000) },
        where: { id: storedSession.id },
      });

      const current = await request(app.getHttpServer())
        .get("/auth/session")
        .set("Cookie", sessionCookie ?? "")
        .expect(200);
      const rotatedSetCookies = current.headers["set-cookie"] as unknown as string[];
      const rotatedCookie = rotatedSetCookies[0]?.split(";", 1)[0];
      expect(rotatedCookie).toMatch(new RegExp(`^${sessionCookieName}=[A-Za-z0-9_-]{43}$`, "u"));
      expect(rotatedCookie).not.toBe(sessionCookie);
      expect(current.headers["x-csrf-token"]).toBe(current.body.csrfToken);
      expect(current.body).toMatchObject({
        csrfToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u),
        user: {
          displayName: "Session Admin",
          email: "Session.Admin@example.com",
          id: user.id,
        },
      });
      await request(app.getHttpServer())
        .get("/auth/session")
        .set("Cookie", sessionCookie ?? "")
        .expect(401);

      const allowedAccess = await request(app.getHttpServer())
        .get(`/sites/${allowedSite.id}/access`)
        .set("Cookie", rotatedCookie ?? "")
        .expect(200);
      expect(allowedAccess.body).toEqual({
        isSystemAdmin: false,
        permissionKeys: ["content.read", "media.read", "site.read"],
        roleKeys: ["viewer"],
        siteId: allowedSite.id,
      });
      await request(app.getHttpServer())
        .get(`/sites/${deniedSite.id}/access`)
        .set("Cookie", rotatedCookie ?? "")
        .expect(403);

      await request(app.getHttpServer())
        .post("/auth/logout")
        .set("Cookie", rotatedCookie ?? "")
        .expect(403);
      await request(app.getHttpServer())
        .post("/auth/logout")
        .set("Cookie", rotatedCookie ?? "")
        .set("x-csrf-token", "b".repeat(43))
        .expect(403);
      await expect(
        prisma.session.findUniqueOrThrow({ where: { id: storedSession.id } }),
      ).resolves.toMatchObject({ revokedAt: null });

      const logout = await request(app.getHttpServer())
        .post("/auth/logout")
        .set("Cookie", rotatedCookie ?? "")
        .set("x-csrf-token", current.body.csrfToken as string)
        .expect(204);
      expect(logout.headers["set-cookie"]?.[0]).toContain(`${sessionCookieName}=;`);
      await request(app.getHttpServer())
        .get("/auth/session")
        .set("Cookie", rotatedCookie ?? "")
        .expect(401);

      await expect(
        prisma.auditEvent.count({
          where: {
            actorId: user.id,
            action: {
              in: [
                "identity.session.created",
                "identity.session.revoked",
                "identity.session.rotated",
              ],
            },
          },
        }),
      ).resolves.toBe(3);
    } finally {
      await app.close();
      await prisma.$disconnect();
    }
  }, 120_000);

  it("authorizes and audits the site lifecycle API", async () => {
    const prisma = createPrismaClient(postgres.getConnectionUri());
    const password = "site lifecycle integration password";
    const existingAdmin = await prisma.user.findFirstOrThrow({ where: { isSystemAdmin: true } });
    const admin = await prisma.user.update({
      data: {
        displayName: "Lifecycle Admin",
        email: "lifecycle.admin@example.com",
        normalizedEmail: "lifecycle.admin@example.com",
        passwordHash: await hashPassword(password),
      },
      where: { id: existingAdmin.id },
    });
    const editor = await prisma.user.create({
      data: {
        displayName: "Lifecycle Editor",
        email: "lifecycle.editor@example.com",
        normalizedEmail: "lifecycle.editor@example.com",
        passwordHash: await hashPassword(password),
      },
    });
    const moduleRef = await Test.createTestingModule({
      controllers: [IdentityController, SitesController],
      providers: [
        IdentityService,
        Reflector,
        SessionAuthenticationGuard,
        SessionCsrfGuard,
        SiteAccessService,
        SiteAuthorizationGuard,
        SiteLifecycleService,
        SystemAdministratorGuard,
        { provide: PRISMA_CLIENT, useValue: prisma },
        {
          provide: IDENTITY_CONFIGURATION,
          useValue: {
            secureCookies: true,
            sessionRotationIntervalMs: 15 * 60 * 1_000,
            sessionTtlMs: 8 * 60 * 60 * 1_000,
          },
        },
      ],
    }).compile();
    const app: INestApplication = moduleRef.createNestApplication();
    configureHttpSecurity(app);
    await app.init();

    const loginAs = async (email: string) => {
      const login = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ email, password })
        .expect(200);
      const cookies = login.headers["set-cookie"] as unknown as string[];
      return {
        cookie: cookies[0]?.split(";", 1)[0] ?? "",
        csrfToken: login.body.csrfToken as string,
      };
    };

    try {
      const adminSession = await loginAs(admin.email);
      await request(app.getHttpServer())
        .post("/sites")
        .set("Cookie", adminSession.cookie)
        .send({ key: "lifecycle-site", name: "Lifecycle Site" })
        .expect(403);

      const created = await request(app.getHttpServer())
        .post("/sites")
        .set("Cookie", adminSession.cookie)
        .set("x-csrf-token", adminSession.csrfToken)
        .send({ key: "lifecycle-site", name: "  Lifecycle Site  " })
        .expect(201);
      expect(created.headers["cache-control"]).toBe("no-store");
      expect(created.body).toMatchObject({
        key: "lifecycle-site",
        name: "Lifecycle Site",
        status: "ACTIVE",
      });

      await request(app.getHttpServer())
        .post("/sites")
        .set("Cookie", adminSession.cookie)
        .set("x-csrf-token", adminSession.csrfToken)
        .send({ key: "lifecycle-site", name: "Duplicate" })
        .expect(409);

      const editorSession = await loginAs(editor.email);
      await request(app.getHttpServer())
        .post("/sites")
        .set("Cookie", editorSession.cookie)
        .set("x-csrf-token", editorSession.csrfToken)
        .send({ key: "forbidden-site", name: "Forbidden" })
        .expect(403);
      await request(app.getHttpServer())
        .get(`/sites/${created.body.id as string}`)
        .set("Cookie", editorSession.cookie)
        .expect(403);

      await prisma.siteRoleAssignment.create({
        data: { roleKey: "viewer", siteId: created.body.id as string, userId: editor.id },
      });
      const editorSites = await request(app.getHttpServer())
        .get("/sites")
        .set("Cookie", editorSession.cookie)
        .expect(200);
      expect(editorSites.body).toEqual([
        expect.objectContaining({ id: created.body.id, key: "lifecycle-site" }),
      ]);
      await request(app.getHttpServer())
        .get(`/sites/${created.body.id as string}`)
        .set("Cookie", editorSession.cookie)
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/sites/${created.body.id as string}/status`)
        .set("Cookie", adminSession.cookie)
        .set("x-csrf-token", adminSession.csrfToken)
        .send({ key: "replacement-key", status: "ARCHIVED" })
        .expect(400);
      const archived = await request(app.getHttpServer())
        .patch(`/sites/${created.body.id as string}/status`)
        .set("Cookie", adminSession.cookie)
        .set("x-csrf-token", adminSession.csrfToken)
        .send({ status: "ARCHIVED" })
        .expect(200);
      expect(archived.body).toMatchObject({ key: "lifecycle-site", status: "ARCHIVED" });

      await expect(
        prisma.auditEvent.findMany({
          orderBy: { createdAt: "asc" },
          select: { action: true, actorId: true, entityId: true, metadata: true },
          where: { actorId: admin.id, entityId: created.body.id as string },
        }),
      ).resolves.toEqual([
        {
          action: "site.created",
          actorId: admin.id,
          entityId: created.body.id,
          metadata: { key: "lifecycle-site", status: "ACTIVE" },
        },
        {
          action: "site.status.changed",
          actorId: admin.id,
          entityId: created.body.id,
          metadata: { from: "ACTIVE", to: "ARCHIVED" },
        },
      ]);
    } finally {
      await app.close();
      await prisma.$disconnect();
    }
  }, 120_000);

  it("enforces optimistic concurrency and scope authorization for settings", async () => {
    const prisma = createPrismaClient(postgres.getConnectionUri());
    const password = "settings integration password";
    const existingAdmin = await prisma.user.findFirstOrThrow({ where: { isSystemAdmin: true } });
    const admin = await prisma.user.update({
      data: { passwordHash: await hashPassword(password) },
      where: { id: existingAdmin.id },
    });
    const site = await prisma.site.findUniqueOrThrow({ where: { key: "lifecycle-site" } });
    const restrictedSite = await prisma.site.create({
      data: { key: "restricted-settings", name: "Restricted Settings" },
    });
    await prisma.siteSetting.create({
      data: {
        key: "site.identity",
        siteId: restrictedSite.id,
        value: { description: "Never expose this configuration", displayName: "Restricted Site" },
      },
    });
    const siteAdmin = await prisma.user.create({
      data: {
        displayName: "Settings Site Admin",
        email: "settings.site.admin@example.com",
        normalizedEmail: "settings.site.admin@example.com",
        passwordHash: await hashPassword(password),
      },
    });
    await prisma.siteRoleAssignment.create({
      data: { roleKey: "site-admin", siteId: site.id, userId: siteAdmin.id },
    });
    const moduleRef = await Test.createTestingModule({
      controllers: [GlobalSettingsController, IdentityController, SiteSettingsController],
      providers: [
        ConfigurationRegistry,
        ConfigurationSettingsService,
        IdentityService,
        Reflector,
        SessionAuthenticationGuard,
        SessionCsrfGuard,
        SiteAccessService,
        SiteAuthorizationGuard,
        SystemAdministratorGuard,
        { provide: PRISMA_CLIENT, useValue: prisma },
        {
          provide: IDENTITY_CONFIGURATION,
          useValue: {
            secureCookies: true,
            sessionRotationIntervalMs: 15 * 60 * 1_000,
            sessionTtlMs: 8 * 60 * 60 * 1_000,
          },
        },
      ],
    }).compile();
    const app: INestApplication = moduleRef.createNestApplication();
    configureHttpSecurity(app);
    await app.init();

    const loginAs = async (email: string) => {
      const login = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ email, password })
        .expect(200);
      const cookies = login.headers["set-cookie"] as unknown as string[];
      return {
        cookie: cookies[0]?.split(";", 1)[0] ?? "",
        csrfToken: login.body.csrfToken as string,
      };
    };

    try {
      const adminSession = await loginAs(admin.email);
      const currentGlobal = await request(app.getHttpServer())
        .get("/settings/global/platform.branding")
        .set("Cookie", adminSession.cookie)
        .expect(200);
      expect(currentGlobal.headers.etag).toBe('"1"');
      expect(currentGlobal.headers["cache-control"]).toBe("no-store");

      await request(app.getHttpServer())
        .put("/settings/global/platform.branding")
        .set("Cookie", adminSession.cookie)
        .set("If-Match", '"1"')
        .send({ productName: "Nexora One" })
        .expect(403);
      await request(app.getHttpServer())
        .put("/settings/global/platform.branding")
        .set("Cookie", adminSession.cookie)
        .set("x-csrf-token", adminSession.csrfToken)
        .set("If-Match", '"99"')
        .send({ productName: "Stale" })
        .expect(412);

      const updatedGlobal = await request(app.getHttpServer())
        .put("/settings/global/platform.branding")
        .set("Cookie", adminSession.cookie)
        .set("x-csrf-token", adminSession.csrfToken)
        .set("If-Match", '"1"')
        .send({ productName: "  Nexora Updated  " })
        .expect(200);
      expect(updatedGlobal.headers.etag).toBe('"2"');
      expect(updatedGlobal.body).toMatchObject({
        value: { productName: "Nexora Updated" },
        version: 2,
      });

      const concurrent = await Promise.all([
        request(app.getHttpServer())
          .put("/settings/global/platform.branding")
          .set("Cookie", adminSession.cookie)
          .set("x-csrf-token", adminSession.csrfToken)
          .set("If-Match", '"2"')
          .send({ productName: "Concurrent A" }),
        request(app.getHttpServer())
          .put("/settings/global/platform.branding")
          .set("Cookie", adminSession.cookie)
          .set("x-csrf-token", adminSession.csrfToken)
          .set("If-Match", '"2"')
          .send({ productName: "Concurrent B" }),
      ]);
      expect(concurrent.map((response) => response.status).sort()).toEqual([200, 412]);
      await expect(
        prisma.globalSetting.findUniqueOrThrow({ where: { key: "platform.branding" } }),
      ).resolves.toMatchObject({ version: 3 });

      const siteAdminSession = await loginAs(siteAdmin.email);
      await request(app.getHttpServer())
        .get("/settings/global")
        .set("Cookie", siteAdminSession.cookie)
        .expect(403);
      await request(app.getHttpServer())
        .get(`/sites/${site.id}/settings/site.identity`)
        .set("Cookie", siteAdminSession.cookie)
        .expect(404);
      await request(app.getHttpServer())
        .put(`/sites/${site.id}/settings/site.identity`)
        .set("Cookie", siteAdminSession.cookie)
        .set("x-csrf-token", siteAdminSession.csrfToken)
        .set("If-None-Match", "*")
        .send({ displayName: "  Lifecycle Settings  " })
        .expect(200)
        .expect("ETag", '"1"');
      await request(app.getHttpServer())
        .put(`/sites/${site.id}/settings/site.identity`)
        .set("Cookie", siteAdminSession.cookie)
        .set("x-csrf-token", siteAdminSession.csrfToken)
        .set("If-None-Match", "*")
        .send({ displayName: "Duplicate" })
        .expect(412);

      const restrictedRead = await request(app.getHttpServer())
        .get(`/sites/${restrictedSite.id}/settings/site.identity`)
        .set("Cookie", siteAdminSession.cookie)
        .expect(403);
      expect(JSON.stringify(restrictedRead.body)).not.toContain("Restricted Site");
      expect(JSON.stringify(restrictedRead.body)).not.toContain("Never expose this configuration");
      const restrictedWrite = await request(app.getHttpServer())
        .put(`/sites/${restrictedSite.id}/settings/site.identity`)
        .set("Cookie", siteAdminSession.cookie)
        .set("x-csrf-token", siteAdminSession.csrfToken)
        .set("If-Match", '"1"')
        .send({ displayName: "Attempted cross-site write" })
        .expect(403);
      expect(JSON.stringify(restrictedWrite.body)).not.toContain("Attempted cross-site write");
      await expect(
        prisma.siteSetting.findUniqueOrThrow({
          where: { siteId_key: { key: "site.identity", siteId: restrictedSite.id } },
        }),
      ).resolves.toMatchObject({
        value: { description: "Never expose this configuration", displayName: "Restricted Site" },
        version: 1,
      });

      const concurrentSiteWrites = await Promise.all([
        request(app.getHttpServer())
          .put(`/sites/${site.id}/settings/site.identity`)
          .set("Cookie", siteAdminSession.cookie)
          .set("x-csrf-token", siteAdminSession.csrfToken)
          .set("If-Match", '"1"')
          .send({ displayName: "Concurrent Site A" }),
        request(app.getHttpServer())
          .put(`/sites/${site.id}/settings/site.identity`)
          .set("Cookie", siteAdminSession.cookie)
          .set("x-csrf-token", siteAdminSession.csrfToken)
          .set("If-Match", '"1"')
          .send({ displayName: "Concurrent Site B" }),
      ]);
      expect(concurrentSiteWrites.map((response) => response.status).sort()).toEqual([200, 412]);
      await expect(
        prisma.siteSetting.findUniqueOrThrow({
          where: { siteId_key: { key: "site.identity", siteId: site.id } },
        }),
      ).resolves.toMatchObject({ version: 2 });

      const sensitiveValue = "NeverPersistInAudit";
      const invalid = await request(app.getHttpServer())
        .put(`/sites/${site.id}/settings/site.identity`)
        .set("Cookie", siteAdminSession.cookie)
        .set("x-csrf-token", siteAdminSession.csrfToken)
        .set("If-Match", '"1"')
        .send({ displayName: "Lifecycle Settings", token: sensitiveValue })
        .expect(400);
      expect(JSON.stringify(invalid.body)).not.toContain(sensitiveValue);

      const auditEvents = await prisma.auditEvent.findMany({
        select: { action: true, metadata: true },
        where: {
          action: { in: ["configuration.global.written", "configuration.site.written"] },
        },
      });
      expect(
        auditEvents.filter((event) => event.action === "configuration.global.written"),
      ).toHaveLength(2);
      expect(
        auditEvents.filter((event) => event.action === "configuration.site.written"),
      ).toHaveLength(2);
      expect(JSON.stringify(auditEvents)).not.toContain("Nexora Updated");
      expect(JSON.stringify(auditEvents)).not.toContain("Lifecycle Settings");
      expect(JSON.stringify(auditEvents)).not.toContain(sensitiveValue);
    } finally {
      await app.close();
      await prisma.$disconnect();
    }
  }, 120_000);

  it("serves only the explicit public configuration projection with a bounded cache policy", async () => {
    const prisma = createPrismaClient(postgres.getConnectionUri());
    const activeSite = await prisma.site.create({
      data: { key: "public-configuration", name: "Administrative Site Name" },
    });
    await prisma.site.create({
      data: { key: "archived-configuration", name: "Archived Site", status: "ARCHIVED" },
    });
    await prisma.globalSetting.upsert({
      create: { key: "platform.branding", value: { productName: "Nexora Public" } },
      update: { value: { productName: "Nexora Public" } },
      where: { key: "platform.branding" },
    });
    await prisma.siteSetting.create({
      data: {
        key: "site.identity",
        siteId: activeSite.id,
        value: { description: "Public configuration", displayName: "Public Site" },
      },
    });

    const moduleRef = await Test.createTestingModule({
      controllers: [PublicConfigurationController],
      providers: [
        ConfigurationRegistry,
        PublicConfigurationService,
        { provide: PRISMA_CLIENT, useValue: prisma },
      ],
    }).compile();
    const app: INestApplication = moduleRef.createNestApplication();
    configureHttpSecurity(app);
    await app.init();

    try {
      const response = await request(app.getHttpServer())
        .get("/public/sites/public-configuration/configuration")
        .set("Cookie", "nexora_session=opaque-session-token")
        .expect(200);

      expect(response.headers["cache-control"]).toBe(
        "public, max-age=60, s-maxage=300, stale-while-revalidate=60",
      );
      expect(response.body).toEqual({
        branding: { productName: "Nexora Public" },
        site: {
          identity: { description: "Public configuration", displayName: "Public Site" },
          key: "public-configuration",
        },
      });
      expect(JSON.stringify(response.body)).not.toContain(activeSite.id);
      expect(JSON.stringify(response.body)).not.toContain("Administrative Site Name");
      expect(response.headers.etag).toMatch(/^W\/"[A-Za-z0-9_-]+"$/u);
      expect(response.headers["set-cookie"]).toBeUndefined();
      await request(app.getHttpServer())
        .get("/public/sites/archived-configuration/configuration")
        .expect(404);
    } finally {
      await app.close();
      await prisma.$disconnect();
    }
  }, 120_000);

  it("rate limits authentication abuse without enumerating users or leaking secrets", async () => {
    const prisma = createPrismaClient(postgres.getConnectionUri());
    const email = "abuse.target@example.com";
    const password = "correct abuse test password";
    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: {
        displayName: "Abuse Target",
        email,
        normalizedEmail: email,
        passwordHash,
      },
    });
    const moduleRef = await Test.createTestingModule({
      controllers: [IdentityController],
      providers: [
        IdentityService,
        { provide: PRISMA_CLIENT, useValue: prisma },
        {
          provide: IDENTITY_CONFIGURATION,
          useValue: {
            secureCookies: true,
            sessionRotationIntervalMs: 15 * 60 * 1_000,
            sessionTtlMs: 8 * 60 * 60 * 1_000,
          },
        },
      ],
    }).compile();
    const app: INestApplication = moduleRef.createNestApplication();
    const logger = new CapturedLogger();
    app.useLogger(logger);
    configureHttpSecurity(app, {
      loginRateLimitMaxRequests: 3,
      loginRateLimitWindowMs: 60_000,
      rateLimitMaxRequests: 100,
    });
    await app.init();

    try {
      const unknownPassword = "unknown account password";
      const wrongPassword = "incorrect known account password";
      const unknownUser = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ email: "unknown.abuse@example.com", password: unknownPassword })
        .expect(401);
      const knownUser = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ email, password: wrongPassword })
        .expect(401);
      const malformedIdentity = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ email: "not-an-email", password })
        .expect(401);
      const limited = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ email, password })
        .expect(429);
      const registration = await request(app.getHttpServer())
        .post("/auth/register")
        .send({ email, password })
        .expect(404);

      expect(knownUser.body).toEqual(unknownUser.body);
      expect(malformedIdentity.body).toEqual(unknownUser.body);
      expect(unknownUser.headers["set-cookie"]).toBeUndefined();
      expect(knownUser.headers["set-cookie"]).toBeUndefined();
      expect(limited.headers["set-cookie"]).toBeUndefined();
      expect(unknownUser.headers["cache-control"]).toBe("no-store");
      expect(limited.headers["cache-control"]).toBe("no-store");
      expect(registration.headers["cache-control"]).toBe("no-store");
      expect(limited.body).toEqual({
        error: "Too Many Requests",
        message: "Too many login attempts.",
        statusCode: 429,
      });
      expect(registration.body).toMatchObject({ statusCode: 404 });
      await expect(prisma.session.count({ where: { userId: user.id } })).resolves.toBe(0);
      await expect(
        prisma.auditEvent.count({
          where: { action: "identity.session.created", actorId: user.id },
        }),
      ).resolves.toBe(0);

      const observableOutput = JSON.stringify({
        logs: logger.entries,
        responses: [
          unknownUser.body,
          knownUser.body,
          malformedIdentity.body,
          limited.body,
          registration.body,
        ],
      });
      for (const secret of [email, password, passwordHash, unknownPassword, wrongPassword]) {
        expect(observableOutput).not.toContain(secret);
      }
    } finally {
      await app.close();
      await prisma.$disconnect();
    }
  }, 120_000);
});
