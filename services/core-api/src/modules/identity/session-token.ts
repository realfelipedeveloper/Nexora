import { createHash, randomBytes } from "node:crypto";

const sessionTokenBytes = 32;

export type IssuedSessionToken = {
  token: string;
  tokenHash: string;
};

export function hashSessionToken(token: string) {
  if (token.length === 0) {
    throw new TypeError("Session token cannot be empty.");
  }

  return createHash("sha256").update(token, "utf8").digest("base64url");
}

export function issueSessionToken(): IssuedSessionToken {
  const token = randomBytes(sessionTokenBytes).toString("base64url");

  return {
    token,
    tokenHash: hashSessionToken(token),
  };
}
