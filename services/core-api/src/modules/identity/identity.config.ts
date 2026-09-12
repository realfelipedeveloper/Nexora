import { Inject } from "@nestjs/common";

const defaultSessionTtlMinutes = 8 * 60;
const defaultSessionRotationMinutes = 15;
const maximumSessionTtlMinutes = 24 * 60;

export const IDENTITY_CONFIGURATION = Symbol("IDENTITY_CONFIGURATION");

export type IdentityConfiguration = {
  secureCookies: boolean;
  sessionRotationIntervalMs: number;
  sessionTtlMs: number;
};

export const InjectIdentityConfiguration = () => Inject(IDENTITY_CONFIGURATION);

export function identityConfiguration(): IdentityConfiguration {
  const configuredMinutes = Number(
    process.env.AUTH_SESSION_TTL_MINUTES ?? defaultSessionTtlMinutes,
  );
  const rotationMinutes = Number(
    process.env.AUTH_SESSION_ROTATION_MINUTES ?? defaultSessionRotationMinutes,
  );

  if (
    !Number.isSafeInteger(configuredMinutes) ||
    configuredMinutes < 5 ||
    configuredMinutes > maximumSessionTtlMinutes
  ) {
    throw new TypeError(
      `AUTH_SESSION_TTL_MINUTES must be an integer between 5 and ${maximumSessionTtlMinutes}.`,
    );
  }

  if (
    !Number.isSafeInteger(rotationMinutes) ||
    rotationMinutes < 1 ||
    rotationMinutes > configuredMinutes
  ) {
    throw new TypeError(
      "AUTH_SESSION_ROTATION_MINUTES must be a positive integer no greater than the session TTL.",
    );
  }

  return {
    secureCookies: process.env.NODE_ENV === "production",
    sessionRotationIntervalMs: rotationMinutes * 60 * 1_000,
    sessionTtlMs: configuredMinutes * 60 * 1_000,
  };
}
