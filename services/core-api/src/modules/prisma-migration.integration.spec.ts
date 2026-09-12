import { execFile } from "node:child_process";
import { platform } from "node:os";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "../database/prisma-client.js";
import {
  AdminAlreadyProvisionedError,
  provisionInitialAdmin,
} from "./identity/admin-provisioning.js";

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
        "Session",
        "Site",
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
});
