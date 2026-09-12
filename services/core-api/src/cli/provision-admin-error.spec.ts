import { describe, expect, it } from "vitest";
import {
  AdminAlreadyProvisionedError,
  InvalidAdminProfileError,
} from "../modules/identity/admin-provisioning.js";
import { AdminProvisionCommandError } from "../modules/identity/admin-provision-command.js";
import { SecureInputError } from "./hidden-input.js";
import { formatProvisioningError } from "./provision-admin-error.js";

describe("administrator provisioning error output", () => {
  it.each([
    new AdminAlreadyProvisionedError(),
    new AdminProvisionCommandError("Invalid command."),
    new InvalidAdminProfileError("Invalid profile."),
    new SecureInputError("Invalid terminal."),
    new RangeError("Invalid password."),
  ])("preserves a known operational error", (error) => {
    expect(formatProvisioningError(error)).toBe(error.message);
  });

  it.each([new Error("postgresql://user:secret@database/nexora"), "driver failure", null])(
    "hides unexpected error details",
    (error) => {
      expect(formatProvisioningError(error)).toBe("Provisioning failed.");
    },
  );
});
