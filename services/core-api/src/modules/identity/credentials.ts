import { argon2id, hash, verify } from "argon2";

export const passwordPolicy = {
  maximumLength: 128,
  minimumLength: 12,
} as const;

export function normalizeEmail(email: string) {
  return email.trim().toLocaleLowerCase("en-US");
}

export function assertPasswordPolicy(password: string) {
  const length = Array.from(password).length;

  if (length < passwordPolicy.minimumLength) {
    throw new RangeError(
      `Password must contain at least ${passwordPolicy.minimumLength} characters.`,
    );
  }

  if (length > passwordPolicy.maximumLength) {
    throw new RangeError(
      `Password must contain at most ${passwordPolicy.maximumLength} characters.`,
    );
  }
}

export async function hashPassword(password: string) {
  assertPasswordPolicy(password);
  return hash(password, { type: argon2id });
}

export async function verifyPassword(passwordHash: string, candidate: string) {
  try {
    return await verify(passwordHash, candidate);
  } catch {
    return false;
  }
}
