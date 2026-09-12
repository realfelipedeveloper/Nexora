ALTER TABLE "User" ADD COLUMN "isSystemAdmin" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "User_single_system_admin_key"
ON "User"("isSystemAdmin")
WHERE "isSystemAdmin" = true;
