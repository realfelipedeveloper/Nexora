import { Inject } from "@nestjs/common";

const defaultSessionTtlMinutes = 8 * 60;
const maximumSessionTtlMinutes = 24 * 60;

export const IDENTITY_CONFIGURATION = Symbol("IDENTITY_CONFIGURATION");

export type IdentityConfiguration = {
  secureCookies: boolean;
  sessionTtlMs: number;
};

export const InjectIdentityConfiguration = () => Inject(IDENTITY_CONFIGURATION);

export function identityConfiguration(): IdentityConfiguration {
  const configuredMinutes = Number(
    process.env.AUTH_SESSION_TTL_MINUTES ?? defaultSessionTtlMinutes,
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

  return {
    secureCookies: process.env.NODE_ENV === "production",
    sessionTtlMs: configuredMinutes * 60 * 1_000,
  };
}
