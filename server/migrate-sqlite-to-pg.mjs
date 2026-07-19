// Script de migração única: copia os dados do data/oficina.db (SQLite) pro Postgres já com o schema criado.
// Rodar manualmente com: node server/migrate-sqlite-to-pg.mjs
// Pré-requisito: o Postgres já deve ter passado pelo menos uma vez pela criação de schema em database.js
// (as tabelas precisam existir, mesmo que vazias).
import { DatabaseSync } from 'node:sqlite'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pool } from './db.js'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const sqlite = new DatabaseSync(join(root, 'data', 'oficina.db'))

const tablesInOrder = [
  'tenants', 'users', 'clients', 'vehicles', 'employees', 'service_orders',
  'order_items', 'vehicle_history', 'reminders', 'notification_logs',
  'pipelines', 'leads', 'crm_activities', 'crm_messages',
  'automation_rules', 'automation_runs', 'invoices', 'invoice_items',
  'vehicle_owners', 'checklists', 'appointments', 'automation_flows',
  'flow_runs', 'payments',
]

async function copyTable(table) {
  const rows = sqlite.prepare(`SELECT * FROM ${table}`).all()
  if (!rows.length) { console.log(`${table}: 0 linhas, pulando`); return }
  const columns = Object.keys(rows[0])
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(',')
  const insertSql = `INSERT INTO ${table} (${columns.join(',')}) VALUES (${placeholders})`
  for (const row of rows) {
    await pool.query(insertSql, columns.map(c => row[c]))
  }
  await pool.query(`SELECT setval(pg_get_serial_sequence('${table}','id'), COALESCE((SELECT MAX(id) FROM ${table}), 1))`)
  console.log(`${table}: ${rows.length} linhas migradas`)
}

for (const table of tablesInOrder) await copyTable(table)

console.log('Migração concluída.')
await pool.end()
