import { Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { InjectPrismaClient } from "../../database/database.module.js";
import {
  isSitePermission,
  sitePermissions,
  type SiteAccess,
  type SitePermission,
} from "./site-permissions.js";

@Injectable()
export class SiteAccessService {
  constructor(@InjectPrismaClient() private readonly prisma: PrismaClient) {}

  async resolveSiteAccess(
    userId: string,
    isSystemAdmin: boolean,
    siteId: string,
  ): Promise<SiteAccess | undefined> {
    if (isSystemAdmin) {
      const site = await this.prisma.site.findUnique({
        select: { id: true },
        where: { id: siteId },
      });

      if (!site) {
        return undefined;
      }

      return {
        isSystemAdmin: true,
        permissionKeys: [...sitePermissions],
        roleKeys: [],
        siteId: site.id,
      };
    }

    const assignments = await this.prisma.siteRoleAssignment.findMany({
      select: {
        role: {
          select: {
            key: true,
            permissions: { select: { permissionKey: true } },
          },
        },
      },
      where: { siteId, userId },
    });

    if (assignments.length === 0) {
      return undefined;
    }

    const roleKeys = new Set<string>();
    const permissionKeys = new Set<SitePermission>();

    for (const assignment of assignments) {
      roleKeys.add(assignment.role.key);
      for (const rolePermission of assignment.role.permissions) {
        if (isSitePermission(rolePermission.permissionKey)) {
          permissionKeys.add(rolePermission.permissionKey);
        }
      }
    }

    return {
      isSystemAdmin: false,
      permissionKeys: [...permissionKeys].sort(),
      roleKeys: [...roleKeys].sort(),
      siteId,
    };
  }
}
