CREATE TYPE "MenuItemLinkType" AS ENUM ('INTERNAL', 'EXTERNAL');
CREATE TYPE "RoutingPathKind" AS ENUM ('ROUTE', 'ALIAS', 'REDIRECT');

CREATE TABLE "Menu" (
  "id" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "localeId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Menu_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MenuItem" (
  "id" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "menuId" TEXT NOT NULL,
  "parentId" TEXT,
  "label" TEXT NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  "isVisible" BOOLEAN NOT NULL DEFAULT true,
  "linkType" "MenuItemLinkType" NOT NULL,
  "routeId" TEXT,
  "externalUrl" VARCHAR(2048),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MenuItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MenuItem_link_target_check" CHECK (
    ("linkType" = 'INTERNAL' AND "routeId" IS NOT NULL AND "externalUrl" IS NULL)
    OR ("linkType" = 'EXTERNAL' AND "routeId" IS NULL AND "externalUrl" IS NOT NULL)
  )
);

CREATE TABLE "RoutingPath" (
  "id" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "localeId" TEXT NOT NULL,
  "path" VARCHAR(1024) NOT NULL,
  "kind" "RoutingPathKind" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RoutingPath_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RoutingPath_normalized_check" CHECK (
    "path" LIKE '/%' AND "path" = lower("path") AND "path" !~ '//|[?#]'
  )
);

CREATE TABLE "Route" (
  "id" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "localeId" TEXT NOT NULL,
  "pathId" TEXT NOT NULL,
  "contentEntryId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Route_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RouteAlias" (
  "id" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "localeId" TEXT NOT NULL,
  "pathId" TEXT NOT NULL,
  "routeId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RouteAlias_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Redirect" (
  "id" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "localeId" TEXT NOT NULL,
  "sourcePathId" TEXT NOT NULL,
  "targetPath" VARCHAR(1024) NOT NULL,
  "statusCode" INTEGER NOT NULL DEFAULT 301,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Redirect_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Redirect_status_check" CHECK ("statusCode" IN (301, 302, 307, 308)),
  CONSTRAINT "Redirect_target_check" CHECK (
    "targetPath" LIKE '/%' AND "targetPath" = lower("targetPath") AND "targetPath" !~ '//|[?#]'
  )
);

CREATE UNIQUE INDEX "Menu_id_siteId_key" ON "Menu"("id", "siteId");
CREATE UNIQUE INDEX "Menu_siteId_localeId_key_key" ON "Menu"("siteId", "localeId", "key");
CREATE INDEX "Menu_siteId_localeId_createdAt_id_idx" ON "Menu"("siteId", "localeId", "createdAt", "id");
CREATE UNIQUE INDEX "MenuItem_id_menuId_key" ON "MenuItem"("id", "menuId");
CREATE INDEX "MenuItem_siteId_menuId_parentId_isVisible_position_id_idx" ON "MenuItem"("siteId", "menuId", "parentId", "isVisible", "position", "id");
CREATE INDEX "MenuItem_siteId_routeId_idx" ON "MenuItem"("siteId", "routeId");
CREATE UNIQUE INDEX "RoutingPath_id_siteId_localeId_key" ON "RoutingPath"("id", "siteId", "localeId");
CREATE UNIQUE INDEX "RoutingPath_siteId_localeId_path_key" ON "RoutingPath"("siteId", "localeId", "path");
CREATE INDEX "RoutingPath_siteId_localeId_kind_createdAt_id_idx" ON "RoutingPath"("siteId", "localeId", "kind", "createdAt", "id");
CREATE UNIQUE INDEX "Route_pathId_key" ON "Route"("pathId");
CREATE UNIQUE INDEX "Route_id_siteId_key" ON "Route"("id", "siteId");
CREATE UNIQUE INDEX "Route_id_siteId_localeId_key" ON "Route"("id", "siteId", "localeId");
CREATE UNIQUE INDEX "Route_pathId_siteId_localeId_key" ON "Route"("pathId", "siteId", "localeId");
CREATE INDEX "Route_siteId_localeId_createdAt_id_idx" ON "Route"("siteId", "localeId", "createdAt", "id");
CREATE INDEX "Route_siteId_contentEntryId_idx" ON "Route"("siteId", "contentEntryId");
CREATE UNIQUE INDEX "RouteAlias_pathId_key" ON "RouteAlias"("pathId");
CREATE UNIQUE INDEX "RouteAlias_pathId_siteId_localeId_key" ON "RouteAlias"("pathId", "siteId", "localeId");
CREATE INDEX "RouteAlias_siteId_localeId_routeId_createdAt_idx" ON "RouteAlias"("siteId", "localeId", "routeId", "createdAt");
CREATE UNIQUE INDEX "Redirect_sourcePathId_key" ON "Redirect"("sourcePathId");
CREATE UNIQUE INDEX "Redirect_sourcePathId_siteId_localeId_key" ON "Redirect"("sourcePathId", "siteId", "localeId");
CREATE INDEX "Redirect_siteId_localeId_createdAt_id_idx" ON "Redirect"("siteId", "localeId", "createdAt", "id");

ALTER TABLE "Menu" ADD CONSTRAINT "Menu_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Menu" ADD CONSTRAINT "Menu_localeId_siteId_fkey" FOREIGN KEY ("localeId", "siteId") REFERENCES "Locale"("id", "siteId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MenuItem" ADD CONSTRAINT "MenuItem_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MenuItem" ADD CONSTRAINT "MenuItem_menuId_siteId_fkey" FOREIGN KEY ("menuId", "siteId") REFERENCES "Menu"("id", "siteId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MenuItem" ADD CONSTRAINT "MenuItem_parentId_menuId_fkey" FOREIGN KEY ("parentId", "menuId") REFERENCES "MenuItem"("id", "menuId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MenuItem" ADD CONSTRAINT "MenuItem_routeId_siteId_fkey" FOREIGN KEY ("routeId", "siteId") REFERENCES "Route"("id", "siteId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RoutingPath" ADD CONSTRAINT "RoutingPath_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RoutingPath" ADD CONSTRAINT "RoutingPath_localeId_siteId_fkey" FOREIGN KEY ("localeId", "siteId") REFERENCES "Locale"("id", "siteId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Route" ADD CONSTRAINT "Route_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Route" ADD CONSTRAINT "Route_localeId_siteId_fkey" FOREIGN KEY ("localeId", "siteId") REFERENCES "Locale"("id", "siteId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Route" ADD CONSTRAINT "Route_pathId_siteId_localeId_fkey" FOREIGN KEY ("pathId", "siteId", "localeId") REFERENCES "RoutingPath"("id", "siteId", "localeId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Route" ADD CONSTRAINT "Route_contentEntryId_siteId_fkey" FOREIGN KEY ("contentEntryId", "siteId") REFERENCES "ContentEntry"("id", "siteId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RouteAlias" ADD CONSTRAINT "RouteAlias_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RouteAlias" ADD CONSTRAINT "RouteAlias_localeId_siteId_fkey" FOREIGN KEY ("localeId", "siteId") REFERENCES "Locale"("id", "siteId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RouteAlias" ADD CONSTRAINT "RouteAlias_pathId_siteId_localeId_fkey" FOREIGN KEY ("pathId", "siteId", "localeId") REFERENCES "RoutingPath"("id", "siteId", "localeId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RouteAlias" ADD CONSTRAINT "RouteAlias_routeId_siteId_localeId_fkey" FOREIGN KEY ("routeId", "siteId", "localeId") REFERENCES "Route"("id", "siteId", "localeId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Redirect" ADD CONSTRAINT "Redirect_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Redirect" ADD CONSTRAINT "Redirect_localeId_siteId_fkey" FOREIGN KEY ("localeId", "siteId") REFERENCES "Locale"("id", "siteId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Redirect" ADD CONSTRAINT "Redirect_sourcePathId_siteId_localeId_fkey" FOREIGN KEY ("sourcePathId", "siteId", "localeId") REFERENCES "RoutingPath"("id", "siteId", "localeId") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION prevent_menu_item_hierarchy_cycle() RETURNS trigger AS $$
DECLARE cycle_found BOOLEAN;
BEGIN
  IF NEW."parentId" IS NULL THEN RETURN NEW; END IF;
  IF NEW."parentId" = NEW."id" THEN RAISE EXCEPTION 'menu item hierarchy cycle'; END IF;
  WITH RECURSIVE ancestors AS (
    SELECT "id", "parentId" FROM "MenuItem" WHERE "id" = NEW."parentId" AND "menuId" = NEW."menuId"
    UNION ALL
    SELECT item."id", item."parentId" FROM "MenuItem" item JOIN ancestors ON item."id" = ancestors."parentId" WHERE item."menuId" = NEW."menuId"
  ) SELECT EXISTS (SELECT 1 FROM ancestors WHERE "id" = NEW."id") INTO cycle_found;
  IF cycle_found THEN RAISE EXCEPTION 'menu item hierarchy cycle'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "MenuItem_prevent_hierarchy_cycle"
BEFORE INSERT OR UPDATE OF "parentId", "menuId" ON "MenuItem"
FOR EACH ROW EXECUTE FUNCTION prevent_menu_item_hierarchy_cycle();

CREATE OR REPLACE FUNCTION prevent_redirect_loop() RETURNS trigger AS $$
DECLARE loop_found BOOLEAN;
DECLARE source_value TEXT;
BEGIN
  SELECT "path" INTO source_value FROM "RoutingPath" WHERE "id" = NEW."sourcePathId";
  IF source_value = NEW."targetPath" THEN RAISE EXCEPTION 'redirect loop'; END IF;
  WITH RECURSIVE chain(path, depth) AS (
    SELECT NEW."targetPath", 1
    UNION ALL
    SELECT redirect."targetPath", chain.depth + 1
    FROM chain
    JOIN "RoutingPath" routing_path ON routing_path."siteId" = NEW."siteId" AND routing_path."localeId" = NEW."localeId" AND routing_path."path" = chain.path AND routing_path."kind" = 'REDIRECT'
    JOIN "Redirect" redirect ON redirect."sourcePathId" = routing_path."id"
    WHERE chain.depth < 32
  ) SELECT EXISTS (SELECT 1 FROM chain WHERE path = source_value OR depth = 32) INTO loop_found;
  IF loop_found THEN RAISE EXCEPTION 'redirect loop'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Redirect_prevent_loop"
BEFORE INSERT OR UPDATE OF "targetPath", "sourcePathId" ON "Redirect"
FOR EACH ROW EXECUTE FUNCTION prevent_redirect_loop();
