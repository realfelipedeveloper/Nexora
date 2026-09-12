import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { runAdminProvisionCommand } from "./admin-provision-command.js";

function commandDependencies() {
  const prisma = { $disconnect: vi.fn() } as unknown as PrismaClient;

  return {
    createClient: vi.fn(() => prisma),
    prisma,
    provision: vi.fn().mockResolvedValue({
      displayName: "Admin",
      email: "admin@example.com",
      id: "admin-1",
    }),
    readSecret: vi
      .fn()
      .mockResolvedValueOnce("correct horse battery staple")
      .mockResolvedValueOnce("correct horse battery staple"),
    writeOutput: vi.fn(),
  };
}

describe("administrator provisioning command", () => {
  it.each([
    { arguments: [], label: "empty arguments" },
    { arguments: ["admin@example.com"], label: "missing display name" },
    {
      arguments: ["admin@example.com", "Admin", "extra"],
      label: "unexpected arguments",
    },
  ])("rejects $label", async ({ arguments: arguments_ }) => {
    await expect(
      runAdminProvisionCommand(
        { arguments: arguments_, databaseUrl: "postgresql://localhost/nexora" },
        commandDependencies(),
      ),
    ).rejects.toThrow(/Usage:/u);
  });

  it("requires an explicit database URL", async () => {
    await expect(
      runAdminProvisionCommand(
        { arguments: ["admin@example.com", "Admin"] },
        commandDependencies(),
      ),
    ).rejects.toThrow(/DATABASE_URL/u);
  });

  it("rejects mismatched password confirmation before opening a database connection", async () => {
    const dependencies = commandDependencies();
    dependencies.readSecret
      .mockReset()
      .mockResolvedValueOnce("first")
      .mockResolvedValueOnce("second");

    await expect(
      runAdminProvisionCommand(
        {
          arguments: ["admin@example.com", "Admin"],
          databaseUrl: "postgresql://localhost/nexora",
        },
        dependencies,
      ),
    ).rejects.toThrow(/does not match/u);
    expect(dependencies.createClient).not.toHaveBeenCalled();
  });

  it("provisions the administrator and always disconnects", async () => {
    const dependencies = commandDependencies();

    await runAdminProvisionCommand(
      {
        arguments: ["admin@example.com", "Nexora Admin"],
        databaseUrl: "postgresql://localhost/nexora",
      },
      dependencies,
    );

    expect(dependencies.provision).toHaveBeenCalledWith(dependencies.prisma, {
      displayName: "Nexora Admin",
      email: "admin@example.com",
      password: "correct horse battery staple",
    });
    expect(dependencies.writeOutput).toHaveBeenCalledWith(
      "System administrator provisioned with id admin-1.\n",
    );
    expect(dependencies.prisma.$disconnect).toHaveBeenCalledOnce();
  });

  it("disconnects after a provisioning failure", async () => {
    const dependencies = commandDependencies();
    dependencies.provision.mockRejectedValueOnce(new Error("database failure"));

    await expect(
      runAdminProvisionCommand(
        {
          arguments: ["admin@example.com", "Admin"],
          databaseUrl: "postgresql://localhost/nexora",
        },
        dependencies,
      ),
    ).rejects.toThrow(/database failure/u);
    expect(dependencies.prisma.$disconnect).toHaveBeenCalledOnce();
  });
});
