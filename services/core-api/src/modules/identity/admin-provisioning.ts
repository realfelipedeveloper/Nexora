import { Prisma, type PrismaClient } from "@prisma/client";
import { hashPassword, normalizeEmail } from "./credentials.js";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const maximumEmailLength = 254;
const maximumDisplayNameLength = 120;
const systemAdminProvisioningLockId = 42_410_001;

export type AdminProvisioningInput = {
  displayName: string;
  email: string;
  password: string;
};

export type ProvisionedAdmin = {
  displayName: string;
  email: string;
  id: string;
};

export class AdminAlreadyProvisionedError extends Error {
  override readonly name = "AdminAlreadyProvisionedError";

  constructor() {
    super("A system administrator has already been provisioned.");
  }
}

export class InvalidAdminProfileError extends Error {
  override readonly name = "InvalidAdminProfileError";
}

function validateProfile(input: AdminProvisioningInput) {
  const email = input.email.trim();
  const displayName = input.displayName.trim();
  const displayNameLength = Array.from(displayName).length;

  if (email.length === 0 || email.length > maximumEmailLength || !emailPattern.test(email)) {
    throw new InvalidAdminProfileError("A valid administrator email is required.");
  }

  if (displayNameLength === 0 || displayNameLength > maximumDisplayNameLength) {
    throw new InvalidAdminProfileError(
      `Administrator display name must contain between 1 and ${maximumDisplayNameLength} characters.`,
    );
  }

  return {
    displayName,
    email,
    normalizedEmail: normalizeEmail(email),
  };
}

function isProvisioningConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export async function provisionInitialAdmin(
  prisma: PrismaClient,
  input: AdminProvisioningInput,
): Promise<ProvisionedAdmin> {
  const profile = validateProfile(input);
  const passwordHash = await hashPassword(input.password);

  try {
    return await prisma.$transaction(
      async (transaction) => {
        // Serialize this one-time invariant across every API and CLI replica.
        await transaction.$queryRaw`SELECT pg_advisory_xact_lock(${systemAdminProvisioningLockId})::text AS locked`;

        const existingAdmin = await transaction.user.findFirst({
          select: { id: true },
          where: { isSystemAdmin: true },
        });

        if (existingAdmin) {
          throw new AdminAlreadyProvisionedError();
        }

        const user = await transaction.user.create({
          data: {
            ...profile,
            isSystemAdmin: true,
            passwordHash,
          },
          select: {
            displayName: true,
            email: true,
            id: true,
          },
        });

        await transaction.auditEvent.create({
          data: {
            action: "identity.system_admin.provisioned",
            actorId: user.id,
            entity: "User",
            entityId: user.id,
            metadata: { source: "admin-provisioning-cli" },
          },
        });

        return user;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: 5_000,
        timeout: 10_000,
      },
    );
  } catch (error) {
    if (error instanceof AdminAlreadyProvisionedError) {
      throw error;
    }

    if (isProvisioningConflict(error)) {
      const existingAdmin = await prisma.user.findFirst({
        select: { id: true },
        where: { isSystemAdmin: true },
      });

      if (existingAdmin) {
        throw new AdminAlreadyProvisionedError();
      }
    }

    throw error;
  }
}
