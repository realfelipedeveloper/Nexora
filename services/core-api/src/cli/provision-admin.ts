import { createPrismaClient } from "../database/prisma-client.js";
import {
  defaultAdminProvision,
  runAdminProvisionCommand,
} from "../modules/identity/admin-provision-command.js";
import { readHiddenInput } from "./hidden-input.js";
import { formatProvisioningError } from "./provision-admin-error.js";

async function main() {
  await runAdminProvisionCommand(
    {
      arguments: process.argv.slice(2),
      databaseUrl: process.env.DATABASE_URL,
    },
    {
      createClient: createPrismaClient,
      provision: defaultAdminProvision,
      readSecret: readHiddenInput,
      writeOutput: (message) => process.stdout.write(message),
    },
  );
}

void main().catch((error: unknown) => {
  process.stderr.write(`${formatProvisioningError(error)}\n`);
  process.exitCode = 1;
});
