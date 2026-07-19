/**
 * Gateway único para canais de atendimento. O modo `mock` permite testar o
 * CRM sem enviar mensagens externas. Para produção, use as variáveis do .env.
 */
const provider = process.env.MESSAGING_PROVIDER || 'mock'
const graphVersion = process.env.META_GRAPH_VERSION || 'v22.0'

async function metaRequest(path, token, body) {
  const response = await fetch(`https://graph.facebook.com/${graphVersion}/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await response.json()
  if (!response.ok) throw new Error(payload?.error?.message || 'Falha na API da Meta.')
  return payload
}

async function evolutionRequest(path, body) {
  const baseUrl = process.env.EVOLUTION_API_URL
  const apiKey = process.env.EVOLUTION_API_KEY
  const instance = process.env.EVOLUTION_INSTANCE
  if (!baseUrl || !apiKey || !instance) throw new Error('Configure EVOLUTION_API_URL, EVOLUTION_API_KEY e EVOLUTION_INSTANCE.')
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/${path}/${instance}`, {
    method: 'POST',
    headers: { apikey: apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload?.message || payload?.error || 'Falha na Evolution API.')
  return payload
}

export async function sendExternalMessage({ channel, recipient, content }) {
  if (provider === 'mock') return { id: `mock-${Date.now()}`, provider: 'mock' }
  if (provider === 'evolution') {
    if (channel !== 'whatsapp') throw new Error('A Evolution API só envia mensagens de WhatsApp.')
    const number = String(recipient).replace(/\D/g, '')
    const result = await evolutionRequest('message/sendText', { number, text: content })
    return { id: result.key?.id || `evolution-${Date.now()}`, provider: 'evolution_api' }
  }
  if (channel === 'whatsapp') {
    const token = process.env.WHATSAPP_ACCESS_TOKEN
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID
    if (!token || !phoneNumberId) throw new Error('Configure WHATSAPP_ACCESS_TOKEN e WHATSAPP_PHONE_NUMBER_ID.')
    const to = String(recipient).replace(/\D/g, '')
    const result = await metaRequest(`${phoneNumberId}/messages`, token, { messaging_product: 'whatsapp', to, type: 'text', text: { body: content } })
    return { id: result.messages?.[0]?.id, provider: 'whatsapp_cloud_api' }
  }
  if (channel === 'instagram') {
    const token = process.env.INSTAGRAM_ACCESS_TOKEN
    const accountId = process.env.INSTAGRAM_ACCOUNT_ID
    if (!token || !accountId) throw new Error('Configure INSTAGRAM_ACCESS_TOKEN e INSTAGRAM_ACCOUNT_ID.')
    const result = await metaRequest(`${accountId}/messages`, token, { recipient: { id: recipient }, message: { text: content } })
    return { id: result.message_id, provider: 'instagram_graph_api' }
  }
  throw new Error(`Canal não suportado: ${channel}.`)
}
