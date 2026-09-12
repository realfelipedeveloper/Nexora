import {
  CanActivate,
  ConflictException,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { InjectIdentityConfiguration, type IdentityConfiguration } from "./identity.config.js";
import {
  AuthenticationFailedError,
  IdentityService,
  SessionRotationConflictError,
} from "./identity.service.js";
import {
  csrfHeaderName,
  readSessionCookie,
  sessionCookieClearOptions,
  sessionCookieName,
  sessionCookieOptions,
} from "./session-security.js";

export type RequestIdentity = {
  csrfToken: string;
  expiresAt: Date;
  sessionId: string;
  user: {
    displayName: string;
    email: string;
    id: string;
    isSystemAdmin: boolean;
  };
};

export type AuthenticatedRequest = {
  headers: { cookie?: string };
  identity?: RequestIdentity;
};

type AuthenticationResponse = {
  clearCookie: (name: string, options: ReturnType<typeof sessionCookieClearOptions>) => void;
  cookie: (name: string, value: string, options: ReturnType<typeof sessionCookieOptions>) => void;
  setHeader: (name: string, value: string) => void;
};

@Injectable()
export class SessionAuthenticationGuard implements CanActivate {
  constructor(
    @Inject(IdentityService) private readonly identity: IdentityService,
    @InjectIdentityConfiguration()
    private readonly configuration: Pick<IdentityConfiguration, "secureCookies">,
  ) {}

  async canActivate(context: ExecutionContext) {
    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    const response = http.getResponse<AuthenticationResponse>();
    const sessionToken = readSessionCookie(request.headers.cookie);

    try {
      const session = await this.identity.authenticateSession(sessionToken);
      request.identity = {
        csrfToken: session.csrfToken,
        expiresAt: session.expiresAt,
        sessionId: session.sessionId,
        user: session.user,
      };

      if (session.rotated) {
        response.cookie(
          sessionCookieName,
          session.sessionToken,
          sessionCookieOptions(this.configuration.secureCookies, session.expiresAt),
        );
        response.setHeader(csrfHeaderName, session.csrfToken);
      }

      return true;
    } catch (error) {
      if (error instanceof AuthenticationFailedError) {
        response.clearCookie(
          sessionCookieName,
          sessionCookieClearOptions(this.configuration.secureCookies),
        );
        throw new UnauthorizedException("Authentication required.");
      }

      if (error instanceof SessionRotationConflictError) {
        response.setHeader("Retry-After", "1");
        throw new ConflictException("Session rotation must be retried.");
      }

      throw error;
    }
  }
}
