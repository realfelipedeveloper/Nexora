import { execFile } from "node:child_process";
import { platform } from "node:os";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
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

const execFileAsync = promisify(execFile);
const workspaceRoot = fileURLToPath(new URL("../../../../", import.meta.url));

describe("Prisma baseline migration", () => {
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
        "Locale",
        "Permission",
        "Role",
        "RolePermission",
        "Session",
        "Site",
        "SiteRoleAssignment",
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
});
