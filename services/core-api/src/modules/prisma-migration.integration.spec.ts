import { execFile } from "node:child_process";
import { platform } from "node:os";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Test } from "@nestjs/testing";
import type { INestApplication, LoggerService } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PRISMA_CLIENT } from "../database/database.module.js";
import { createPrismaClient } from "../database/prisma-client.js";
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
        "ContentType",
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

  it("enforces seeded roles and isolates editorial access by site", async () => {
    const prisma = createPrismaClient(postgres.getConnectionUri());

    try {
      await expect(prisma.permission.count()).resolves.toBe(10);
      await expect(prisma.role.count()).resolves.toBe(4);
      await expect(prisma.rolePermission.count()).resolves.toBe(24);

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
      const attempts = await Promise.allSettled([
        provisionInitialAdmin(prisma, {
          displayName: "First Admin",
          email: "first@example.com",
          password: "first secure administrator password",
        }),
        provisionInitialAdmin(prisma, {
          displayName: "Second Admin",
          email: "second@example.com",
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
      ).toHaveLength(1);
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
