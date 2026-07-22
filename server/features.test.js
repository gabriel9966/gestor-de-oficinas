// Testes de integração leves pras features de catálogo/estoque, fornecedores/contas a pagar,
// estações de trabalho, links públicos e relatório financeiro. Mesmo padrão do api.test.js:
// exigem o servidor rodando em localhost:3001 e pulam automaticamente se ele não responder.
// Rodam tudo dentro de uma oficina descartável criada só pra este arquivo, desativada no final.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'

const BASE = 'http://localhost:3001'
let serverUp = false
try { serverUp = (await fetch(`${BASE}/api/health`)).ok } catch { serverUp = false }

async function login(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
  return res.json()
}
const admin = serverUp ? await login('admin@oficinapro.com', 'admin123') : null

async function createTenant() {
  return fetch(`${BASE}/api/admin/tenants`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Teste Features Automatizado', owner_name: 'Teste', owner_email: `teste-features-${Date.now()}@isolamento.com`, owner_password: 'teste123', plan: 'scale' }),
  }).then(r => r.json())
}
const tenant = serverUp ? await createTenant() : null
const headers = tenant ? { Authorization: `Bearer ${admin.token}`, 'X-Tenant-Override': String(tenant.id), 'Content-Type': 'application/json' } : {}
const skip = !serverUp && 'servidor não está rodando em localhost:3001'

test('catalog: create part with stock tracking and adjust stock', { skip }, async () => {
  const created = await fetch(`${BASE}/api/catalog`, { method: 'POST', headers, body: JSON.stringify({ type: 'peca', name: 'Item Teste', sku: 'TESTE-1', track_stock: true, quantity: 5, min_quantity: 10 }) }).then(r => r.json())
  assert.equal(created.quantity, 5)

  const lowStock = await fetch(`${BASE}/api/catalog?low_stock=1`, { headers }).then(r => r.json())
  assert.ok(lowStock.some(i => i.id === created.id), 'item abaixo do mínimo deveria aparecer no filtro low_stock')

  const adjusted = await fetch(`${BASE}/api/catalog/${created.id}/stock`, { method: 'POST', headers, body: JSON.stringify({ delta: 20, reason: 'Reposição de teste' }) }).then(r => r.json())
  assert.equal(adjusted.quantity, 25)

  await fetch(`${BASE}/api/catalog/${created.id}`, { method: 'DELETE', headers })
})

test('suppliers/payables: overdue detection and mark as paid', { skip }, async () => {
  const supplier = await fetch(`${BASE}/api/suppliers`, { method: 'POST', headers, body: JSON.stringify({ name: 'Fornecedor Teste' }) }).then(r => r.json())
  const payable = await fetch(`${BASE}/api/payables`, { method: 'POST', headers, body: JSON.stringify({ supplier_id: supplier.id, description: 'Conta vencida de teste', amount: 100, due_date: '2020-01-01' }) }).then(r => r.json())

  const list = await fetch(`${BASE}/api/payables`, { headers }).then(r => r.json())
  const found = list.find(p => p.id === payable.id)
  assert.equal(found.effective_status, 'atrasado')

  const paid = await fetch(`${BASE}/api/payables/${payable.id}`, { method: 'PATCH', headers, body: JSON.stringify({ status: 'pago' }) }).then(r => r.json())
  assert.equal(paid.status, 'pago')
  assert.ok(paid.paid_at)

  await fetch(`${BASE}/api/payables/${payable.id}`, { method: 'DELETE', headers })
  await fetch(`${BASE}/api/suppliers/${supplier.id}`, { method: 'DELETE', headers })
})

test('work stations: two open orders cannot occupy the same station', { skip }, async () => {
  const station = await fetch(`${BASE}/api/work-stations`, { method: 'POST', headers, body: JSON.stringify({ name: 'Box Teste', type: 'box' }) }).then(r => r.json())
  const orderA = await fetch(`${BASE}/api/checkin`, { method: 'POST', headers, body: JSON.stringify({ client_name: 'Cliente Teste A', plate: 'TST0001', mileage: 100 }) }).then(r => r.json())
  const orderB = await fetch(`${BASE}/api/checkin`, { method: 'POST', headers, body: JSON.stringify({ client_name: 'Cliente Teste B', plate: 'TST0002', mileage: 100 }) }).then(r => r.json())

  const first = await fetch(`${BASE}/api/orders/${orderA.id}`, { method: 'PATCH', headers, body: JSON.stringify({ work_station_id: station.id }) })
  assert.equal(first.status, 200)

  const conflict = await fetch(`${BASE}/api/orders/${orderB.id}`, { method: 'PATCH', headers, body: JSON.stringify({ work_station_id: station.id }) })
  assert.equal(conflict.status, 409)

  await fetch(`${BASE}/api/work-stations/${station.id}`, { method: 'DELETE', headers })
})

test('public links: vehicle record and budget approval flow', { skip }, async () => {
  const order = await fetch(`${BASE}/api/checkin`, { method: 'POST', headers, body: JSON.stringify({ client_name: 'Cliente Teste Publico', plate: 'TST0003', mileage: 100 }) }).then(r => r.json())

  const vehicleLink = await fetch(`${BASE}/api/vehicles/${order.vehicle_id}/public-link`, { method: 'POST', headers }).then(r => r.json())
  const publicVehicle = await fetch(`${BASE}${vehicleLink.path.replace('/v/', '/public/vehicles/')}`).then(r => r.json())
  assert.equal(publicVehicle.vehicle.plate, 'TST0003')

  await fetch(`${BASE}/api/orders/${order.id}`, { method: 'PATCH', headers, body: JSON.stringify({ status: 'aguardando_aprovacao' }) })
  const approvalLink = await fetch(`${BASE}/api/orders/${order.id}/approval-link`, { method: 'POST', headers }).then(r => r.json())
  const publicOrder = await fetch(`${BASE}${approvalLink.path.replace('/orcamento/', '/public/orders/')}`).then(r => r.json())
  assert.equal(publicOrder.awaiting, true)

  const approve = await fetch(`${BASE}${approvalLink.path.replace('/orcamento/', '/public/orders/')}/approve`, { method: 'POST' }).then(r => r.json())
  assert.ok(approve.message)

  const updatedOrder = await fetch(`${BASE}/api/orders/${order.id}`, { headers }).then(r => r.json())
  assert.equal(updatedOrder.status, 'em_execucao')
})

test('reports: cashflow returns the requested number of months', { skip }, async () => {
  const report = await fetch(`${BASE}/api/reports/cashflow?months=3`, { headers }).then(r => r.json())
  assert.equal(report.series.length, 3)
  assert.ok('revenue' in report.totals && 'expenses' in report.totals && 'balance' in report.totals)
})

// Roda garantidamente depois de todos os testes deste arquivo (mesmo que executem em paralelo,
// diferente de um test() declarado por último — que não tem essa garantia de ordem).
after(async () => {
  if (!serverUp) return
  await fetch(`${BASE}/api/admin/tenants/${tenant.id}`, { method: 'PATCH', headers: { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'canceled', active: 0 }) })
})
