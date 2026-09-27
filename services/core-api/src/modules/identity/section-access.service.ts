import { Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { InjectPrismaClient } from "../../database/database.module.js";
import { SiteAccessService } from "./site-access.service.js";
import { isSitePermission, sitePermissions, type SitePermission } from "./site-permissions.js";

export type SectionAccess = {
  isSystemAdmin: boolean;
  permissionKeys: readonly SitePermission[];
  roleKeys: readonly string[];
  scope: "SECTION" | "SITE";
  sectionId: string;
  siteId: string;
};

@Injectable()
export class SectionAccessService {
  constructor(
    @InjectPrismaClient() private readonly prisma: PrismaClient,
    private readonly siteAccess: SiteAccessService,
  ) {}

  async resolveSectionAccess(
    userId: string,
    isSystemAdmin: boolean,
    siteId: string,
    sectionId: string,
  ): Promise<SectionAccess | undefined> {
    const section = await this.prisma.section.findUnique({
      select: { id: true },
      where: { id_siteId: { id: sectionId, siteId } },
    });
    if (!section) {
      return undefined;
    }

    if (isSystemAdmin) {
      return {
        isSystemAdmin: true,
        permissionKeys: [...sitePermissions],
        roleKeys: [],
        scope: "SITE",
        sectionId,
        siteId,
      };
    }

    const siteAccess = await this.siteAccess.resolveSiteAccess(userId, false, siteId);
    if (siteAccess) {
      return { ...siteAccess, scope: "SITE", sectionId };
    }

    const assignments = await this.prisma.sectionRoleAssignment.findMany({
      select: {
        role: {
          select: {
            key: true,
            permissions: { select: { permissionKey: true } },
          },
        },
      },
      where: { sectionId, siteId, userId },
    });
    if (assignments.length === 0) {
      return undefined;
    }

    const permissionKeys = new Set<SitePermission>();
    const roleKeys = new Set<string>();
    for (const assignment of assignments) {
      roleKeys.add(assignment.role.key);
      for (const permission of assignment.role.permissions) {
        if (isSitePermission(permission.permissionKey)) {
          permissionKeys.add(permission.permissionKey);
        }
      }
    }

    return {
      isSystemAdmin: false,
      permissionKeys: [...permissionKeys].sort(),
      roleKeys: [...roleKeys].sort(),
      scope: "SECTION",
      sectionId,
      siteId,
    };
  }
}
