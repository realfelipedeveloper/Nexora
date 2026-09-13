export const sitePermissions = [
  "site.read",
  "content.read",
  "content.write",
  "content.publish",
  "media.read",
  "media.write",
  "settings.read",
  "settings.write",
  "members.read",
  "members.manage",
] as const;

export type SitePermission = (typeof sitePermissions)[number];

export type SiteAccess = {
  isSystemAdmin: boolean;
  permissionKeys: readonly SitePermission[];
  roleKeys: readonly string[];
  siteId: string;
};

export function isSitePermission(value: string): value is SitePermission {
  return (sitePermissions as readonly string[]).includes(value);
}

export function hasSitePermissions(
  access: SiteAccess,
  requiredPermissions: readonly SitePermission[],
) {
  const grantedPermissions = new Set(access.permissionKeys);
  return requiredPermissions.every((permission) => grantedPermissions.has(permission));
}
