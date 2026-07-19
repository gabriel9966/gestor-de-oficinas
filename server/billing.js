import { run, one } from './db.js'

// Provedor trocável por env var, mesmo padrão do messaging.js. Hoje só "mock" existe.
// Pra plugar Stripe/Mercado Pago depois: implementar essas duas funções de verdade,
// mantendo a mesma assinatura, e trocar BILLING_PROVIDER.
const PLAN_PRICES = { starter: 0, pro: 199, scale: 499 }

async function mockCreateCheckoutSession(tenant, plan) {
  const amount = PLAN_PRICES[plan] ?? 0
  const r = await run("INSERT INTO saas_invoices (tenant_id,plan,amount,status,provider_reference) VALUES (?,?,?,'paid',?) RETURNING id", [tenant.id, plan, amount, `mock_${Date.now()}`])
  await run("UPDATE tenants SET plan=?,status='active' WHERE id=?", [plan, tenant.id])
  return { checkout_url: null, simulated: true, invoice_id: r.lastInsertRowid }
}

export async function createCheckoutSession(tenant, plan) {
  const provider = process.env.BILLING_PROVIDER || 'mock'
  if (provider === 'mock') return mockCreateCheckoutSession(tenant, plan)
  throw new Error(`Provedor de cobrança "${provider}" não implementado ainda.`)
}

export async function handleWebhookEvent(payload) {
  // Placeholder pronto pra receber eventos reais (ex: invoice.paid, invoice.payment_failed) de um provedor de verdade.
  // Formato do payload varia por provedor — quando plugar um real, mapear pra este shape antes de chamar isso.
  const { tenant_id, status } = payload
  if (!tenant_id || !status) return
  const tenant = await one('SELECT id FROM tenants WHERE id=?', [tenant_id])
  if (!tenant) return
  if (status === 'paid') await run("UPDATE tenants SET status='active' WHERE id=?", [tenant.id])
  else if (status === 'failed') await run("UPDATE tenants SET status='past_due' WHERE id=?", [tenant.id])
}
