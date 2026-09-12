import {
  AdminAlreadyProvisionedError,
  InvalidAdminProfileError,
} from "../modules/identity/admin-provisioning.js";
import { AdminProvisionCommandError } from "../modules/identity/admin-provision-command.js";
import { SecureInputError } from "./hidden-input.js";

export function formatProvisioningError(error: unknown) {
  if (
    error instanceof AdminAlreadyProvisionedError ||
    error instanceof AdminProvisionCommandError ||
    error instanceof InvalidAdminProfileError ||
    error instanceof SecureInputError ||
    error instanceof RangeError
  ) {
    return error.message;
  }

  return "Provisioning failed.";
}
