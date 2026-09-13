import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { csrfHeaderName, isValidCsrfToken, readSessionCookie } from "./session-security.js";
import type { AuthenticatedRequest } from "./session-authentication.guard.js";

type AdministrativeRequest = AuthenticatedRequest & {
  headers: { cookie?: string; [csrfHeaderName]?: string | string[] };
};

@Injectable()
export class SystemAdministratorGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.identity?.user.isSystemAdmin) {
      throw new ForbiddenException("System administrator access required.");
    }

    return true;
  }
}

@Injectable()
export class SessionCsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AdministrativeRequest>();
    const candidate = request.headers[csrfHeaderName];
    const sessionToken = readSessionCookie(request.headers.cookie);

    if (
      !sessionToken ||
      typeof candidate !== "string" ||
      !isValidCsrfToken(sessionToken, candidate)
    ) {
      throw new ForbiddenException("CSRF validation failed.");
    }

    return true;
  }
}
