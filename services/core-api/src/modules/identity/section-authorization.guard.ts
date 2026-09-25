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
import { SectionAccessService, type SectionAccess } from "./section-access.service.js";
import { hasSitePermissions, type SitePermission } from "./site-permissions.js";

const requiredSectionPermissions = Symbol("required-section-permissions");
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type SectionScopedRequest = AuthenticatedRequest & {
  params?: Record<string, string | undefined>;
  sectionAccess?: SectionAccess;
};

export function RequireSectionPermissions(...permissions: SitePermission[]) {
  if (permissions.length === 0) {
    throw new TypeError("At least one section permission is required.");
  }
  return SetMetadata(requiredSectionPermissions, permissions);
}

@Injectable()
export class SectionAuthorizationGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(SectionAccessService) private readonly access: SectionAccessService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<SectionScopedRequest>();
    if (!request.identity) {
      throw new UnauthorizedException("Authentication required.");
    }

    const permissions = this.reflector.getAllAndOverride<SitePermission[]>(
      requiredSectionPermissions,
      [context.getHandler(), context.getClass()],
    );
    const sectionId = request.params?.sectionId;
    const siteId = request.params?.siteId;
    if (
      !permissions?.length ||
      !sectionId ||
      !siteId ||
      !uuidPattern.test(sectionId) ||
      !uuidPattern.test(siteId)
    ) {
      throw new ForbiddenException("Section access denied.");
    }

    const access = await this.access.resolveSectionAccess(
      request.identity.user.id,
      request.identity.user.isSystemAdmin,
      siteId,
      sectionId,
    );
    if (!access || !hasSitePermissions(access, permissions)) {
      throw new ForbiddenException("Section access denied.");
    }

    request.sectionAccess = access;
    return true;
  }
}
