CREATE INDEX "AuditEvent_action_entity_entityId_createdAt_id_idx"
  ON "AuditEvent"("action", "entity", "entityId", "createdAt" DESC, "id" DESC);
