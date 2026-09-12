import { Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { InjectPrismaClient } from "../../database/database.module.js";
import { normalizeEmail, passwordPolicy, verifyPassword } from "./credentials.js";
import { InjectIdentityConfiguration, type IdentityConfiguration } from "./identity.config.js";
import { deriveCsrfToken, isValidCsrfToken } from "./session-security.js";
import { hashSessionToken, issueSessionToken } from "./session-token.js";

const dummyPasswordHash =
  "$argon2id$v=19$m=65536,p=4,t=3$n+PQUTI9fTULsbjvSZp1YQ$OYP4OafIBHRG41vqRoRHBrd7CgfewhREpb86e7vHcv8";
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const maximumEmailLength = 254;

type PublicUser = {
  displayName: string;
  email: string;
  id: string;
  isSystemAdmin: boolean;
};

export class AuthenticationFailedError extends Error {
  override readonly name = "AuthenticationFailedError";

  constructor() {
    super("Invalid email or password.");
  }
}

export class CsrfValidationError extends Error {
  override readonly name = "CsrfValidationError";

  constructor() {
    super("Invalid CSRF token.");
  }
}

function publicUser(user: PublicUser): PublicUser {
  return {
    displayName: user.displayName,
    email: user.email,
    id: user.id,
    isSystemAdmin: user.isSystemAdmin,
  };
}

@Injectable()
export class IdentityService {
  constructor(
    @InjectPrismaClient() private readonly prisma: PrismaClient,
    @InjectIdentityConfiguration()
    private readonly configuration: Pick<IdentityConfiguration, "sessionTtlMs">,
  ) {}

  async login(email: string, password: string) {
    const trimmedEmail = email.trim();
    const passwordLength = Array.from(password).length;
    const plausibleEmail =
      trimmedEmail.length > 0 &&
      trimmedEmail.length <= maximumEmailLength &&
      emailPattern.test(trimmedEmail);
    const plausiblePassword =
      passwordLength >= passwordPolicy.minimumLength &&
      passwordLength <= passwordPolicy.maximumLength;
    const normalizedEmail = plausibleEmail ? normalizeEmail(email) : "invalid@invalid.invalid";
    const user = await this.prisma.user.findUnique({
      select: {
        displayName: true,
        email: true,
        id: true,
        isSystemAdmin: true,
        passwordHash: true,
        status: true,
      },
      where: { normalizedEmail },
    });
    const validPassword = await verifyPassword(
      user?.passwordHash ?? dummyPasswordHash,
      plausiblePassword ? password : "invalid password",
    );

    if (
      !plausibleEmail ||
      !plausiblePassword ||
      !user ||
      !validPassword ||
      user.status !== "ACTIVE"
    ) {
      throw new AuthenticationFailedError();
    }

    const { token: sessionToken, tokenHash } = issueSessionToken();
    const expiresAt = new Date(Date.now() + this.configuration.sessionTtlMs);

    await this.prisma.$transaction(async (transaction) => {
      const session = await transaction.session.create({
        data: {
          expiresAt,
          tokenHash,
          userId: user.id,
        },
        select: { id: true },
      });

      await transaction.auditEvent.create({
        data: {
          action: "identity.session.created",
          actorId: user.id,
          entity: "Session",
          entityId: session.id,
          metadata: {},
        },
      });
    });

    return {
      csrfToken: deriveCsrfToken(sessionToken),
      expiresAt,
      sessionToken,
      user: publicUser(user),
    };
  }

  async currentSession(sessionToken: string | undefined) {
    if (!sessionToken) {
      throw new AuthenticationFailedError();
    }

    const session = await this.findSession(sessionToken);

    if (!this.isActiveSession(session)) {
      throw new AuthenticationFailedError();
    }

    return {
      csrfToken: deriveCsrfToken(sessionToken),
      expiresAt: session.expiresAt,
      user: publicUser(session.user),
    };
  }

  async logout(sessionToken: string | undefined, csrfToken: string | undefined) {
    if (!sessionToken) {
      return;
    }

    const session = await this.findSession(sessionToken);

    if (!this.isActiveSession(session)) {
      return;
    }

    if (!isValidCsrfToken(sessionToken, csrfToken)) {
      throw new CsrfValidationError();
    }

    const revokedAt = new Date();
    await this.prisma.$transaction(async (transaction) => {
      const update = await transaction.session.updateMany({
        data: { revokedAt },
        where: { id: session.id, revokedAt: null },
      });

      if (update.count === 0) {
        return;
      }

      await transaction.auditEvent.create({
        data: {
          action: "identity.session.revoked",
          actorId: session.user.id,
          entity: "Session",
          entityId: session.id,
          metadata: { reason: "logout" },
        },
      });
    });
  }

  private async findSession(sessionToken: string) {
    return this.prisma.session.findUnique({
      select: {
        expiresAt: true,
        id: true,
        revokedAt: true,
        user: {
          select: {
            displayName: true,
            email: true,
            id: true,
            isSystemAdmin: true,
            status: true,
          },
        },
      },
      where: { tokenHash: hashSessionToken(sessionToken) },
    });
  }

  private isActiveSession(
    session: Awaited<ReturnType<IdentityService["findSession"]>>,
  ): session is NonNullable<Awaited<ReturnType<IdentityService["findSession"]>>> {
    return Boolean(
      session &&
      session.revokedAt === null &&
      session.expiresAt.getTime() > Date.now() &&
      session.user.status === "ACTIVE",
    );
  }
}
