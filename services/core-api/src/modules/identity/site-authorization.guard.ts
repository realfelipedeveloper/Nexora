import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { AuthenticatedRequest } from "./session-authentication.guard.js";
import { SiteAccessService } from "./site-access.service.js";
import { hasSitePermissions, type SiteAccess, type SitePermission } from "./site-permissions.js";

const requiredSitePermissions = Symbol("required-site-permissions");
const siteIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type SiteScopedRequest = AuthenticatedRequest & {
  params?: Record<string, string | undefined>;
  siteAccess?: SiteAccess;
};

export function RequireSitePermissions(...permissions: SitePermission[]) {
  if (permissions.length === 0) {
    throw new TypeError("At least one site permission is required.");
  }

  return SetMetadata(requiredSitePermissions, permissions);
}

@Injectable()
export class SiteAuthorizationGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(SiteAccessService) private readonly siteAccess: SiteAccessService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<SiteScopedRequest>();
    if (!request.identity) {
      throw new UnauthorizedException("Authentication required.");
    }

    const permissions = this.reflector.getAllAndOverride<SitePermission[]>(
      requiredSitePermissions,
      [context.getHandler(), context.getClass()],
    );
    const siteId = request.params?.siteId;

    if (!permissions?.length || !siteId || !siteIdPattern.test(siteId)) {
      throw new ForbiddenException("Site access denied.");
    }

    const access = await this.siteAccess.resolveSiteAccess(
      request.identity.user.id,
      request.identity.user.isSystemAdmin,
      siteId,
    );

    if (!access || !hasSitePermissions(access, permissions)) {
      throw new ForbiddenException("Site access denied.");
    }

    request.siteAccess = access;
    return true;
  }
}
