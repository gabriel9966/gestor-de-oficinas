// Testes de integração leves: exigem o servidor rodando em localhost:3001 contra o Postgres
// (npm run server, com o container docker-compose ativo). Pulam automaticamente se o servidor não responder,
// pra não quebrar o "npm test" em ambientes sem o backend de pé.
import { test } from 'node:test'
import assert from 'node:assert/strict'

const BASE = 'http://localhost:3001'
let serverUp = false
try { serverUp = (await fetch(`${BASE}/api/health`)).ok } catch { serverUp = false }

async function login(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
  return res.json()
}

test('login: rejects invalid credentials', { skip: !serverUp && 'servidor não está rodando em localhost:3001' }, async () => {
  const res = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'dono@autocenterprime.com', password: 'senhaerrada' }) })
  assert.equal(res.status, 401)
})

test('business routes: reject requests without a token', { skip: !serverUp && 'servidor não está rodando em localhost:3001' }, async () => {
  const res = await fetch(`${BASE}/api/orders`)
  assert.equal(res.status, 401)
})

test('tenant isolation: a client created in one tenant is invisible from another', { skip: !serverUp && 'servidor não está rodando em localhost:3001' }, async () => {
  const admin = await login('admin@oficinapro.com', 'admin123')
  const owner = await login('dono@autocenterprime.com', 'dono123')

  const created = await fetch(`${BASE}/api/admin/tenants`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Teste Isolamento Automatizado', owner_name: 'Teste', owner_email: `teste-${Date.now()}@isolamento.com`, owner_password: 'teste123' }),
  }).then(r => r.json())

  const client = await fetch(`${BASE}/api/clients`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${admin.token}`, 'X-Tenant-Override': String(created.id), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Cliente Só Da Nova Oficina' }),
  }).then(r => r.json())

  const ownerSearch = await fetch(`${BASE}/api/clients?search=${encodeURIComponent(client.name)}`, { headers: { Authorization: `Bearer ${owner.token}` } }).then(r => r.json())
  assert.equal(ownerSearch.length, 0)

  // limpeza
  await fetch(`${BASE}/api/admin/tenants/${created.id}`, { method: 'PATCH', headers: { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'canceled', active: 0 }) })
})

test('plan gating: automation flows require the scale plan', { skip: !serverUp && 'servidor não está rodando em localhost:3001' }, async () => {
  const admin = await login('admin@oficinapro.com', 'admin123')
  const created = await fetch(`${BASE}/api/admin/tenants`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Teste Plano Starter', owner_name: 'Teste', owner_email: `teste-plan-${Date.now()}@isolamento.com`, owner_password: 'teste123', plan: 'starter' }),
  }).then(r => r.json())

  const res = await fetch(`${BASE}/api/automation-flows`, { headers: { Authorization: `Bearer ${admin.token}`, 'X-Tenant-Override': String(created.id) } })
  assert.equal(res.status, 403)

  await fetch(`${BASE}/api/admin/tenants/${created.id}`, { method: 'PATCH', headers: { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'canceled', active: 0 }) })
})
