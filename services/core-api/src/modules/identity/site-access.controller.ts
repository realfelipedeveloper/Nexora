import { Controller, ForbiddenException, Get, Header, Req, UseGuards } from "@nestjs/common";
import { SessionAuthenticationGuard } from "./session-authentication.guard.js";
import {
  RequireSitePermissions,
  SiteAuthorizationGuard,
  type SiteScopedRequest,
} from "./site-authorization.guard.js";

@Controller("sites/:siteId/access")
@UseGuards(SessionAuthenticationGuard, SiteAuthorizationGuard)
export class SiteAccessController {
  @Get()
  @Header("Cache-Control", "no-store")
  @RequireSitePermissions("site.read")
  currentAccess(@Req() request: SiteScopedRequest) {
    if (!request.siteAccess) {
      throw new ForbiddenException("Site access denied.");
    }

    return request.siteAccess;
  }
}
