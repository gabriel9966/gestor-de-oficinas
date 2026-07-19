import { run } from './db.js'

export async function logAudit({ tenantId = null, userId = null, action, entity = null, entityId = null, metadata = null }) {
  await run('INSERT INTO audit_logs (tenant_id,user_id,action,entity,entity_id,metadata) VALUES (?,?,?,?,?,?) RETURNING id', [tenantId, userId, action, entity, entityId, metadata ? JSON.stringify(metadata) : null])
}
