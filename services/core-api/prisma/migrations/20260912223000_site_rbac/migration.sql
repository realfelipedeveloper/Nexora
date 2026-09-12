CREATE TABLE "Permission" (
  "key" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  CONSTRAINT "Permission_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "Role" (
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  CONSTRAINT "Role_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "RolePermission" (
  "roleKey" TEXT NOT NULL,
  "permissionKey" TEXT NOT NULL,
  CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleKey", "permissionKey")
);

CREATE TABLE "SiteRoleAssignment" (
  "id" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "roleKey" TEXT NOT NULL,
  "grantedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SiteRoleAssignment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RolePermission_permissionKey_idx" ON "RolePermission"("permissionKey");
CREATE UNIQUE INDEX "SiteRoleAssignment_siteId_userId_roleKey_key" ON "SiteRoleAssignment"("siteId", "userId", "roleKey");
CREATE INDEX "SiteRoleAssignment_userId_siteId_idx" ON "SiteRoleAssignment"("userId", "siteId");
CREATE INDEX "SiteRoleAssignment_siteId_roleKey_idx" ON "SiteRoleAssignment"("siteId", "roleKey");
CREATE INDEX "SiteRoleAssignment_grantedById_idx" ON "SiteRoleAssignment"("grantedById");

ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleKey_fkey" FOREIGN KEY ("roleKey") REFERENCES "Role"("key") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionKey_fkey" FOREIGN KEY ("permissionKey") REFERENCES "Permission"("key") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SiteRoleAssignment" ADD CONSTRAINT "SiteRoleAssignment_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SiteRoleAssignment" ADD CONSTRAINT "SiteRoleAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SiteRoleAssignment" ADD CONSTRAINT "SiteRoleAssignment_roleKey_fkey" FOREIGN KEY ("roleKey") REFERENCES "Role"("key") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SiteRoleAssignment" ADD CONSTRAINT "SiteRoleAssignment_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "Permission" ("key", "description") VALUES
  ('site.read', 'View a site and its editorial workspace.'),
  ('content.read', 'View site content and drafts.'),
  ('content.write', 'Create and edit site content.'),
  ('content.publish', 'Publish and unpublish site content.'),
  ('media.read', 'View the site media library.'),
  ('media.write', 'Add, update, and remove site media.'),
  ('settings.read', 'View site settings.'),
  ('settings.write', 'Change site settings.'),
  ('members.read', 'View site members and their roles.'),
  ('members.manage', 'Assign and revoke site roles.');

INSERT INTO "Role" ("key", "name", "description") VALUES
  ('viewer', 'Viewer', 'Read-only editorial access.'),
  ('editor', 'Editor', 'Create and edit content and media.'),
  ('publisher', 'Publisher', 'Edit and publish content and media.'),
  ('site-admin', 'Site administrator', 'Manage all editorial capabilities for one site.');

INSERT INTO "RolePermission" ("roleKey", "permissionKey") VALUES
  ('viewer', 'site.read'),
  ('viewer', 'content.read'),
  ('viewer', 'media.read'),
  ('editor', 'site.read'),
  ('editor', 'content.read'),
  ('editor', 'content.write'),
  ('editor', 'media.read'),
  ('editor', 'media.write'),
  ('publisher', 'site.read'),
  ('publisher', 'content.read'),
  ('publisher', 'content.write'),
  ('publisher', 'content.publish'),
  ('publisher', 'media.read'),
  ('publisher', 'media.write'),
  ('site-admin', 'site.read'),
  ('site-admin', 'content.read'),
  ('site-admin', 'content.write'),
  ('site-admin', 'content.publish'),
  ('site-admin', 'media.read'),
  ('site-admin', 'media.write'),
  ('site-admin', 'settings.read'),
  ('site-admin', 'settings.write'),
  ('site-admin', 'members.read'),
  ('site-admin', 'members.manage');
