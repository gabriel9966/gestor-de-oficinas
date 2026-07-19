import { exec, one, many, run } from './db.js'
import { hashPassword } from './auth.js'

// now_text() replica o formato do antigo CURRENT_TIMESTAMP do SQLite (UTC, "YYYY-MM-DD HH:MM:SS", sem timezone)
// pra manter o mesmo formato de string que o resto do código já espera em created_at/updated_at.
await exec(`CREATE OR REPLACE FUNCTION now_text() RETURNS text AS $$ SELECT to_char(timezone('UTC', now()), 'YYYY-MM-DD HH24:MI:SS') $$ LANGUAGE sql;`)

await exec(`
CREATE TABLE IF NOT EXISTS tenants (id SERIAL PRIMARY KEY, name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, plan TEXT NOT NULL DEFAULT 'starter' CHECK(plan IN ('starter','pro','scale')), status TEXT NOT NULL DEFAULT 'trial' CHECK(status IN ('trial','active','past_due','canceled')), currency TEXT NOT NULL DEFAULT 'BRL', distance_unit TEXT NOT NULL DEFAULT 'KM' CHECK(distance_unit IN ('KM','MI')), expires_at TEXT, billing_customer_ref TEXT, created_at TEXT DEFAULT now_text());
CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id), name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'owner' CHECK(role IN ('owner','super_admin')), active INTEGER NOT NULL DEFAULT 1, totp_secret TEXT, totp_enabled INTEGER NOT NULL DEFAULT 0, reset_token TEXT, reset_token_expires_at TEXT, created_at TEXT DEFAULT now_text());
CREATE TABLE IF NOT EXISTS clients (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 1, name TEXT NOT NULL, document TEXT, phone TEXT, email TEXT, whatsapp_opt_in INTEGER DEFAULT 1, notes TEXT, anonymized_at TEXT, created_at TEXT DEFAULT now_text(), updated_at TEXT DEFAULT now_text(), UNIQUE(tenant_id, document));
CREATE TABLE IF NOT EXISTS vehicles (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 1, client_id INTEGER NOT NULL REFERENCES clients(id), plate TEXT, chassis TEXT, brand TEXT NOT NULL, model TEXT NOT NULL, version TEXT, year_model INTEGER, color TEXT, fuel TEXT, mileage INTEGER NOT NULL DEFAULT 0, notes TEXT, created_at TEXT DEFAULT now_text(), updated_at TEXT DEFAULT now_text(), UNIQUE(tenant_id, plate), UNIQUE(tenant_id, chassis));
CREATE TABLE IF NOT EXISTS employees (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 1, name TEXT NOT NULL, role TEXT NOT NULL, phone TEXT, specialty TEXT, active INTEGER DEFAULT 1, created_at TEXT DEFAULT now_text());
CREATE TABLE IF NOT EXISTS service_orders (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 1, number TEXT NOT NULL UNIQUE, client_id INTEGER NOT NULL REFERENCES clients(id), vehicle_id INTEGER NOT NULL REFERENCES vehicles(id), mechanic_id INTEGER REFERENCES employees(id), status TEXT NOT NULL DEFAULT 'aberta', priority TEXT DEFAULT 'normal', checkin_at TEXT DEFAULT now_text(), estimated_delivery_at TEXT, completed_at TEXT, delivered_at TEXT, mileage_in INTEGER NOT NULL, mileage_out INTEGER, fuel_level TEXT, customer_complaint TEXT, diagnosis TEXT, solution TEXT, internal_notes TEXT, discount REAL DEFAULT 0, total_amount REAL DEFAULT 0, paid_amount REAL DEFAULT 0, payment_status TEXT DEFAULT 'pendente', payment_method TEXT, created_at TEXT DEFAULT now_text(), updated_at TEXT DEFAULT now_text());
CREATE TABLE IF NOT EXISTS order_items (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 1, service_order_id INTEGER NOT NULL REFERENCES service_orders(id) ON DELETE CASCADE, type TEXT NOT NULL CHECK(type IN ('peca','servico','taxa')), description TEXT NOT NULL, quantity REAL DEFAULT 1, unit_price REAL DEFAULT 0, approved INTEGER DEFAULT 0, completed INTEGER DEFAULT 0, warranty_days INTEGER, created_at TEXT DEFAULT now_text());
CREATE TABLE IF NOT EXISTS vehicle_history (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 1, vehicle_id INTEGER NOT NULL REFERENCES vehicles(id), service_order_id INTEGER REFERENCES service_orders(id) ON DELETE SET NULL, event_type TEXT NOT NULL, description TEXT NOT NULL, mileage INTEGER, created_at TEXT DEFAULT now_text());
CREATE TABLE IF NOT EXISTS reminders (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 1, client_id INTEGER NOT NULL REFERENCES clients(id), vehicle_id INTEGER NOT NULL REFERENCES vehicles(id), service_order_id INTEGER REFERENCES service_orders(id) ON DELETE SET NULL, type TEXT NOT NULL, due_date TEXT, due_mileage INTEGER, status TEXT DEFAULT 'agendado', channel TEXT DEFAULT 'whatsapp', message TEXT, sent_at TEXT, created_at TEXT DEFAULT now_text());
CREATE TABLE IF NOT EXISTS notification_logs (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 1, reminder_id INTEGER NOT NULL REFERENCES reminders(id) ON DELETE CASCADE, channel TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pronto_para_envio', recipient TEXT, message TEXT NOT NULL, created_at TEXT DEFAULT now_text(), sent_at TEXT);
CREATE TABLE IF NOT EXISTS pipelines (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 1, name TEXT NOT NULL, stages TEXT NOT NULL, created_at TEXT DEFAULT now_text());
CREATE TABLE IF NOT EXISTS leads (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 1, name TEXT NOT NULL, document TEXT, phone TEXT, email TEXT, source TEXT DEFAULT 'manual', pipeline_id INTEGER REFERENCES pipelines(id), stage TEXT NOT NULL DEFAULT 'novo', estimated_value REAL DEFAULT 0, vehicle_interest TEXT, notes TEXT, converted_client_id INTEGER REFERENCES clients(id), created_at TEXT DEFAULT now_text(), updated_at TEXT DEFAULT now_text());
CREATE TABLE IF NOT EXISTS crm_activities (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 1, lead_id INTEGER REFERENCES leads(id) ON DELETE CASCADE, client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE, type TEXT NOT NULL, description TEXT NOT NULL, scheduled_at TEXT, completed_at TEXT, created_at TEXT DEFAULT now_text(), CHECK(lead_id IS NOT NULL OR client_id IS NOT NULL));
CREATE TABLE IF NOT EXISTS crm_messages (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 1, lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL, client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL, channel TEXT NOT NULL, direction TEXT NOT NULL CHECK(direction IN ('entrada','saida')), recipient TEXT, content TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'fila', provider_message_id TEXT, error TEXT, created_at TEXT DEFAULT now_text(), sent_at TEXT);
CREATE TABLE IF NOT EXISTS automation_rules (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 1, name TEXT NOT NULL, module TEXT NOT NULL CHECK(module IN ('service_orders','leads')), field TEXT NOT NULL, value TEXT NOT NULL, channel TEXT NOT NULL DEFAULT 'whatsapp', message_template TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT DEFAULT now_text());
CREATE TABLE IF NOT EXISTS automation_runs (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 1, rule_id INTEGER NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE, entity_id INTEGER NOT NULL, ran_at TEXT DEFAULT now_text(), UNIQUE(rule_id, entity_id));
CREATE TABLE IF NOT EXISTS invoices (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 1, number TEXT NOT NULL UNIQUE, service_order_id INTEGER NOT NULL REFERENCES service_orders(id), client_id INTEGER NOT NULL REFERENCES clients(id), labor_amount REAL NOT NULL DEFAULT 0, parts_amount REAL NOT NULL DEFAULT 0, discount REAL NOT NULL DEFAULT 0, total_amount REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'emitida' CHECK(status IN ('emitida','cancelada')), issued_at TEXT DEFAULT now_text());
CREATE TABLE IF NOT EXISTS invoice_items (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 1, invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE, order_item_id INTEGER REFERENCES order_items(id), type TEXT NOT NULL CHECK(type IN ('peca','servico','taxa')), description TEXT NOT NULL, quantity REAL NOT NULL DEFAULT 1, unit_price REAL NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS vehicle_owners (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 1, vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE, client_id INTEGER NOT NULL REFERENCES clients(id), started_at TEXT DEFAULT now_text(), ended_at TEXT);
CREATE TABLE IF NOT EXISTS checklists (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 1, service_order_id INTEGER NOT NULL REFERENCES service_orders(id) ON DELETE CASCADE, type TEXT NOT NULL CHECK(type IN ('entrada','saida')), items TEXT NOT NULL, fuel_level TEXT, mileage INTEGER, notes TEXT, completed_at TEXT DEFAULT now_text(), UNIQUE(service_order_id, type));
CREATE TABLE IF NOT EXISTS appointments (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 1, client_id INTEGER NOT NULL REFERENCES clients(id), vehicle_id INTEGER REFERENCES vehicles(id), mechanic_id INTEGER REFERENCES employees(id), service_order_id INTEGER REFERENCES service_orders(id) ON DELETE SET NULL, title TEXT NOT NULL, scheduled_at TEXT NOT NULL, duration_minutes INTEGER NOT NULL DEFAULT 60, status TEXT NOT NULL DEFAULT 'agendado' CHECK(status IN ('agendado','confirmado','concluido','cancelado')), notes TEXT, created_at TEXT DEFAULT now_text(), updated_at TEXT DEFAULT now_text());
CREATE TABLE IF NOT EXISTS automation_flows (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 1, name TEXT NOT NULL, module TEXT NOT NULL CHECK(module IN ('service_orders','leads')), trigger_field TEXT NOT NULL, trigger_value TEXT NOT NULL, steps TEXT NOT NULL DEFAULT '[]', active INTEGER NOT NULL DEFAULT 1, created_at TEXT DEFAULT now_text());
CREATE TABLE IF NOT EXISTS flow_runs (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 1, flow_id INTEGER NOT NULL REFERENCES automation_flows(id) ON DELETE CASCADE, entity_id INTEGER NOT NULL, step_index INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'ativo' CHECK(status IN ('ativo','concluido','cancelado')), resume_at TEXT, created_at TEXT DEFAULT now_text(), updated_at TEXT DEFAULT now_text(), UNIQUE(flow_id, entity_id));
CREATE TABLE IF NOT EXISTS payments (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 1, service_order_id INTEGER NOT NULL REFERENCES service_orders(id) ON DELETE CASCADE, method TEXT NOT NULL CHECK(method IN ('pix','cartao_credito','cartao_debito','dinheiro','boleto')), amount REAL NOT NULL, installments INTEGER NOT NULL DEFAULT 1, created_at TEXT DEFAULT now_text());
CREATE TABLE IF NOT EXISTS audit_logs (id SERIAL PRIMARY KEY, tenant_id INTEGER, user_id INTEGER, action TEXT NOT NULL, entity TEXT, entity_id INTEGER, metadata TEXT, created_at TEXT DEFAULT now_text());
CREATE TABLE IF NOT EXISTS saas_invoices (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id), plan TEXT NOT NULL, amount REAL NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','failed')), provider_reference TEXT, created_at TEXT DEFAULT now_text());
CREATE TABLE IF NOT EXISTS catalog_items (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 1, type TEXT NOT NULL CHECK(type IN ('peca','servico')), name TEXT NOT NULL, sku TEXT, unit_price REAL NOT NULL DEFAULT 0, cost_price REAL NOT NULL DEFAULT 0, track_stock INTEGER NOT NULL DEFAULT 0, quantity REAL NOT NULL DEFAULT 0, min_quantity REAL NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, created_at TEXT DEFAULT now_text(), UNIQUE(tenant_id, sku));
CREATE TABLE IF NOT EXISTS stock_movements (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 1, catalog_item_id INTEGER NOT NULL REFERENCES catalog_items(id) ON DELETE CASCADE, delta REAL NOT NULL, reason TEXT NOT NULL, service_order_id INTEGER REFERENCES service_orders(id) ON DELETE SET NULL, created_at TEXT DEFAULT now_text());
CREATE TABLE IF NOT EXISTS suppliers (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 1, name TEXT NOT NULL, document TEXT, phone TEXT, email TEXT, notes TEXT, active INTEGER NOT NULL DEFAULT 1, created_at TEXT DEFAULT now_text());
CREATE TABLE IF NOT EXISTS payables (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 1, supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL, description TEXT NOT NULL, amount REAL NOT NULL, due_date TEXT, status TEXT NOT NULL DEFAULT 'pendente' CHECK(status IN ('pendente','pago')), paid_at TEXT, created_at TEXT DEFAULT now_text());
CREATE INDEX IF NOT EXISTS idx_catalog_tenant_type ON catalog_items(tenant_id, type);
CREATE INDEX IF NOT EXISTS idx_stock_movements_item ON stock_movements(catalog_item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_suppliers_tenant ON suppliers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_payables_tenant_status ON payables(tenant_id, status, due_date);
CREATE INDEX IF NOT EXISTS idx_orders_vehicle ON service_orders(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_history_vehicle ON vehicle_history(vehicle_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_stage ON leads(stage);
CREATE INDEX IF NOT EXISTS idx_leads_pipeline ON leads(pipeline_id, stage);
CREATE INDEX IF NOT EXISTS idx_activities_lead ON crm_activities(lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_client ON crm_messages(client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_lead ON crm_messages(lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_automation_rules_trigger ON automation_rules(module, field, value);
CREATE INDEX IF NOT EXISTS idx_invoices_order ON invoices(service_order_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_owners_vehicle ON vehicle_owners(vehicle_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_checklists_order ON checklists(service_order_id);
CREATE INDEX IF NOT EXISTS idx_flows_trigger ON automation_flows(module, trigger_field, trigger_value);
CREATE INDEX IF NOT EXISTS idx_flow_runs_due ON flow_runs(status, resume_at);
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(service_order_id);
CREATE INDEX IF NOT EXISTS idx_appointments_scheduled ON appointments(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_appointments_mechanic ON appointments(mechanic_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_tenant ON audit_logs(tenant_id, created_at DESC);
`)
const tenantTables = ['clients','vehicles','employees','service_orders','order_items','vehicle_history','reminders','notification_logs','pipelines','leads','crm_activities','crm_messages','automation_rules','automation_runs','invoices','invoice_items','vehicle_owners','checklists','appointments','automation_flows','flow_runs','payments','catalog_items','suppliers','payables']
for (const table of tenantTables) await exec(`CREATE INDEX IF NOT EXISTS idx_${table}_tenant ON ${table}(tenant_id)`)

// Colunas novas em tabelas que já existiam antes desta rodada de features — ADD COLUMN IF NOT EXISTS é idempotente entre reinícios.
await exec(`ALTER TABLE order_items ADD COLUMN IF NOT EXISTS catalog_item_id INTEGER REFERENCES catalog_items(id)`)
await exec(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS public_token TEXT UNIQUE`)
await exec(`ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS approval_token TEXT UNIQUE`)
await exec(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS whatsapp_phone_id TEXT UNIQUE`)
await exec(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS whatsapp_instance TEXT UNIQUE`)
// 'staff' passa a ser um papel válido pra permitir múltiplos logins por oficina (owner convida a equipe).
await exec(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`)
await exec(`ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('owner','staff','super_admin'))`)

if (!(await one('SELECT id FROM tenants LIMIT 1'))) await run("INSERT INTO tenants (id,name,plan,status,currency,distance_unit) VALUES (1,?,'scale','active','BRL','KM')", ['Auto Center Prime'])

if (!(await one("SELECT id FROM users WHERE role='super_admin' LIMIT 1"))) {
  const email = process.env.SUPER_ADMIN_EMAIL || 'admin@oficinapro.com'
  const password = process.env.SUPER_ADMIN_PASSWORD || 'admin123'
  await run('INSERT INTO users (tenant_id,name,email,password_hash,role) VALUES (NULL,?,?,?,?) RETURNING id', ['Administrador OficinaPro', email, hashPassword(password), 'super_admin'])
  console.log(`[seed] Super admin criado: ${email} / senha: ${password}${process.env.SUPER_ADMIN_PASSWORD ? '' : ' (defina SUPER_ADMIN_EMAIL/SUPER_ADMIN_PASSWORD em produção)'}`)
}
if (!(await one('SELECT id FROM users WHERE tenant_id=1 LIMIT 1'))) {
  const password = 'dono123'
  await run('INSERT INTO users (tenant_id,name,email,password_hash,role) VALUES (1,?,?,?,?) RETURNING id', ['Lucas Pereira', 'dono@autocenterprime.com', hashPassword(password), 'owner'])
  console.log(`[seed] Usuário de teste da oficina 1 criado: dono@autocenterprime.com / senha: ${password}`)
}

const defaultStagesJson = JSON.stringify([{ key: 'novo', label: 'Novo' }, { key: 'contato_feito', label: 'Contato feito' }, { key: 'orcamento', label: 'Orçamento' }, { key: 'negociacao', label: 'Negociação' }, { key: 'ganho', label: 'Ganho' }, { key: 'perdido', label: 'Perdido' }])
export async function ensureDefaultPipeline(tenantId) {
  let pipeline = await one('SELECT * FROM pipelines WHERE tenant_id=? ORDER BY id LIMIT 1', [tenantId])
  if (!pipeline) { const r = await run('INSERT INTO pipelines (tenant_id,name,stages) VALUES (?,?,?) RETURNING id', [tenantId, 'Comercial', defaultStagesJson]); pipeline = await one('SELECT * FROM pipelines WHERE id=?', [r.lastInsertRowid]) }
  return pipeline
}
const defaultPipeline = await ensureDefaultPipeline(1)
await run('UPDATE leads SET pipeline_id=? WHERE pipeline_id IS NULL', [defaultPipeline.id])
if (!(await one('SELECT id FROM clients LIMIT 1'))) {
  const c = await run('INSERT INTO clients (name,document,phone,email) VALUES (?,?,?,?) RETURNING id', ['Mariana Costa','123.456.789-09','(11) 99999-0101','mariana@exemplo.com'])
  const v = await run('INSERT INTO vehicles (client_id,plate,chassis,brand,model,version,year_model,fuel,mileage) VALUES (?,?,?,?,?,?,?,?,?) RETURNING id', [c.lastInsertRowid,'BRA2E19','9BWZZZ377VT004251','Honda','Civic','EXL 2.0',2020,'Flex',78240])
  const e = await run('INSERT INTO employees (name,role,specialty) VALUES (?,?,?) RETURNING id', ['Rafael Lima','mecanico','Revisão e freios'])
  const o = await run('INSERT INTO service_orders (number,client_id,vehicle_id,mechanic_id,status,mileage_in,customer_complaint,diagnosis,total_amount,estimated_delivery_at) VALUES (?,?,?,?,?,?,?,?,?,?) RETURNING id', ['OS-2048',c.lastInsertRowid,v.lastInsertRowid,e.lastInsertRowid,'em_execucao',78240,'Revisão preventiva e ruído ao frear em baixa velocidade.','Pastilhas dianteiras com desgaste acentuado.',1280,'2026-07-12T16:30:00'])
  await run('INSERT INTO order_items (service_order_id,type,description,quantity,unit_price,approved) VALUES (?,?,?,?,?,1) RETURNING id', [o.lastInsertRowid,'servico','Troca de óleo sintético',1,390])
  await run('INSERT INTO order_items (service_order_id,type,description,quantity,unit_price,approved) VALUES (?,?,?,?,?,1) RETURNING id', [o.lastInsertRowid,'peca','Filtro de óleo + ar',1,240])
  await run('INSERT INTO order_items (service_order_id,type,description,quantity,unit_price,approved) VALUES (?,?,?,?,?,1) RETURNING id', [o.lastInsertRowid,'peca','Pastilhas dianteiras',1,650])
  await run('INSERT INTO vehicle_history (vehicle_id,service_order_id,event_type,description,mileage) VALUES (?,?,?,?,?) RETURNING id', [v.lastInsertRowid,o.lastInsertRowid,'entrada','Veículo recebido para revisão de 80.000 km.',78240])
}
if (!(await one('SELECT id FROM vehicle_owners LIMIT 1'))) { for (const v of await many('SELECT id,client_id,created_at FROM vehicles')) await run('INSERT INTO vehicle_owners (vehicle_id,client_id,started_at) VALUES (?,?,?) RETURNING id', [v.id, v.client_id, v.created_at]) }
if (!(await one('SELECT id FROM leads WHERE converted_client_id IS NULL LIMIT 1'))) {
  const lead = async (...args) => run('INSERT INTO leads (name,phone,source,pipeline_id,stage,estimated_value,vehicle_interest) VALUES (?,?,?,?,?,?,?) RETURNING id', args)
  await lead('André Moreira','(11) 99744-2011','Indicação',defaultPipeline.id,'novo',2800,'BMW 320i 2021')
  await lead('Camila Torres','(11) 98821-7850','Instagram',defaultPipeline.id,'contato_feito',1450,'Jeep Compass 2022')
  await lead('Ricardo Viana','(11) 99117-4280','Google',defaultPipeline.id,'orcamento',3600,'Audi A3 2020')
  await lead('Paula Freitas','(11) 99310-5671','Balcão',defaultPipeline.id,'negociacao',980,'Toyota Corolla 2021')
}

export async function nextOrderNumber() { const row = await one("SELECT number FROM service_orders WHERE number LIKE 'OS-%' ORDER BY id DESC LIMIT 1"); return `OS-${row ? Number(row.number.slice(3)) + 1 : 2001}` }
export async function nextInvoiceNumber() { const year = new Date().getFullYear(); const row = await one("SELECT number FROM invoices WHERE number LIKE ? ORDER BY id DESC LIMIT 1", [`NF-${year}-%`]); return `NF-${year}-${row ? Number(row.number.split('-')[2]) + 1 : 1001}` }
export async function recalculateOrderTotal(id) {
  const items = await one('SELECT COALESCE(SUM(quantity*unit_price),0) total FROM order_items WHERE service_order_id=? AND approved=1', [id])
  const order = await one('SELECT discount FROM service_orders WHERE id=?', [id])
  const total = Math.max(0, items.total - (order?.discount || 0))
  await run('UPDATE service_orders SET total_amount=?,updated_at=now_text() WHERE id=?', [total, id])
  return total
}
export async function recalculatePaymentStatus(id) {
  const payments = await many('SELECT method,amount FROM payments WHERE service_order_id=?', [id])
  const order = await one('SELECT total_amount FROM service_orders WHERE id=?', [id])
  const paid = payments.reduce((sum, p) => sum + p.amount, 0)
  const methods = [...new Set(payments.map(p => p.method))]
  const status = payments.length === 0 ? 'pendente' : paid >= (order?.total_amount || 0) && (order?.total_amount || 0) > 0 ? 'pago' : 'parcial'
  const method = methods.length === 0 ? null : methods.length === 1 ? methods[0] : 'misto'
  await run('UPDATE service_orders SET paid_amount=?,payment_status=?,payment_method=?,updated_at=now_text() WHERE id=?', [paid, status, method, id])
  return { paid_amount: paid, payment_status: status, payment_method: method }
}
