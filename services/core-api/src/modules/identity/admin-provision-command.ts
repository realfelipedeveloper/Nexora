import type { PrismaClient } from "@prisma/client";
import {
  provisionInitialAdmin,
  type AdminProvisioningInput,
  type ProvisionedAdmin,
} from "./admin-provisioning.js";

type AdminProvisionCommandOptions = {
  arguments: string[];
  databaseUrl?: string;
};

type AdminProvisionCommandDependencies = {
  createClient: (databaseUrl: string) => PrismaClient;
  provision: (prisma: PrismaClient, input: AdminProvisioningInput) => Promise<ProvisionedAdmin>;
  readSecret: (prompt: string) => Promise<string>;
  writeOutput: (message: string) => void;
};

export class AdminProvisionCommandError extends Error {
  override readonly name = "AdminProvisionCommandError";
}

export async function runAdminProvisionCommand(
  options: AdminProvisionCommandOptions,
  dependencies: AdminProvisionCommandDependencies,
) {
  const [email, displayName, ...unexpectedArguments] = options.arguments;

  if (!email || !displayName || unexpectedArguments.length > 0) {
    throw new AdminProvisionCommandError(
      'Usage: pnpm --filter @nexora/core-api admin:provision -- <email> "<display name>"',
    );
  }

  if (!options.databaseUrl) {
    throw new AdminProvisionCommandError(
      "DATABASE_URL must be explicitly set for administrator provisioning.",
    );
  }

  const password = await dependencies.readSecret("Password: ");
  const confirmation = await dependencies.readSecret("Confirm password: ");

  if (password !== confirmation) {
    throw new AdminProvisionCommandError("Password confirmation does not match.");
  }

  const prisma = dependencies.createClient(options.databaseUrl);

  try {
    const admin = await dependencies.provision(prisma, {
      displayName,
      email,
      password,
    });

    dependencies.writeOutput(`System administrator provisioned with id ${admin.id}.\n`);
  } finally {
    await prisma.$disconnect();
  }
}

export const defaultAdminProvision = provisionInitialAdmin;
