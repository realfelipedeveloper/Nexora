import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Headers,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UnsupportedMediaTypeException,
  UseGuards,
} from "@nestjs/common";
import { InjectIdentityConfiguration, type IdentityConfiguration } from "./identity.config.js";
import {
  AuthenticationFailedError,
  CsrfValidationError,
  IdentityService,
} from "./identity.service.js";
import {
  csrfHeaderName,
  readSessionCookie,
  sessionCookieClearOptions,
  sessionCookieName,
  sessionCookieOptions,
} from "./session-security.js";
import {
  type AuthenticatedRequest,
  SessionAuthenticationGuard,
} from "./session-authentication.guard.js";

type CookieResponse = {
  clearCookie: (name: string, options: ReturnType<typeof sessionCookieClearOptions>) => void;
  cookie: (name: string, value: string, options: ReturnType<typeof sessionCookieOptions>) => void;
};

function loginCredentials(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return undefined;
  }

  const { email, password } = body as Record<string, unknown>;
  if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
    return undefined;
  }

  return { email, password };
}

@Controller("auth")
export class IdentityController {
  constructor(
    @Inject(IdentityService) private readonly identity: IdentityService,
    @InjectIdentityConfiguration()
    private readonly configuration: Pick<IdentityConfiguration, "secureCookies">,
  ) {}

  @Post("login")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  async login(
    @Body() body: unknown,
    @Headers("content-type") contentType: string | undefined,
    @Res({ passthrough: true }) response: CookieResponse,
  ) {
    const mediaType = contentType?.split(";", 1)[0]?.trim().toLowerCase();
    if (mediaType !== "application/json") {
      throw new UnsupportedMediaTypeException("Content-Type must be application/json.");
    }

    const credentials = loginCredentials(body);
    if (!credentials) {
      throw new UnauthorizedException("Invalid email or password.");
    }

    try {
      const result = await this.identity.login(credentials.email, credentials.password);
      response.cookie(
        sessionCookieName,
        result.sessionToken,
        sessionCookieOptions(this.configuration.secureCookies, result.expiresAt),
      );

      return {
        csrfToken: result.csrfToken,
        expiresAt: result.expiresAt,
        user: result.user,
      };
    } catch (error) {
      if (error instanceof AuthenticationFailedError) {
        throw new UnauthorizedException(error.message);
      }

      throw error;
    }
  }

  @Get("session")
  @Header("Cache-Control", "no-store")
  @UseGuards(SessionAuthenticationGuard)
  currentSession(@Req() request: AuthenticatedRequest) {
    if (!request.identity) {
      throw new UnauthorizedException("Authentication required.");
    }

    return {
      csrfToken: request.identity.csrfToken,
      expiresAt: request.identity.expiresAt,
      user: request.identity.user,
    };
  }

  @Post("logout")
  @HttpCode(204)
  @Header("Cache-Control", "no-store")
  async logout(
    @Headers("cookie") cookieHeader: string | undefined,
    @Headers(csrfHeaderName) csrfToken: string | undefined,
    @Res({ passthrough: true }) response: CookieResponse,
  ) {
    try {
      await this.identity.logout(readSessionCookie(cookieHeader), csrfToken);
      response.clearCookie(
        sessionCookieName,
        sessionCookieClearOptions(this.configuration.secureCookies),
      );
    } catch (error) {
      if (error instanceof CsrfValidationError) {
        throw new ForbiddenException(error.message);
      }

      throw error;
    }
  }
}
