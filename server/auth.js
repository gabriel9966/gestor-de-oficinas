import crypto from 'node:crypto'
import { t } from './i18n.js'

const AUTH_SECRET = process.env.AUTH_SECRET || (() => {
  if (process.env.NODE_ENV === 'production') throw new Error('AUTH_SECRET é obrigatório em produção. Defina essa variável de ambiente antes de subir o servidor.')
  console.warn('[auth] AUTH_SECRET não definido no ambiente — usando um segredo fixo de desenvolvimento. Defina AUTH_SECRET em produção.')
  return 'dev-secret-oficinapro-troque-em-producao'
})()
const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60

const b64url = (buf) => Buffer.from(buf).toString('base64url')
const fromB64url = (str) => Buffer.from(str, 'base64url')

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':')
  if (!salt || !hash) return false
  const candidate = crypto.scryptSync(password, salt, 64)
  const expected = Buffer.from(hash, 'hex')
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected)
}

export function signToken(payload) {
  const header = { alg: 'HS256', typ: 'JWT' }
  const body = { ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS }
  const data = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(body))}`
  const signature = crypto.createHmac('sha256', AUTH_SECRET).update(data).digest('base64url')
  return `${data}.${signature}`
}

export function verifyToken(token) {
  const parts = String(token || '').split('.')
  if (parts.length !== 3) return null
  const [headerPart, bodyPart, signature] = parts
  const expected = crypto.createHmac('sha256', AUTH_SECRET).update(`${headerPart}.${bodyPart}`).digest('base64url')
  const sigBuf = Buffer.from(signature)
  const expBuf = Buffer.from(expected)
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null
  let body
  try { body = JSON.parse(fromB64url(bodyPart).toString('utf8')) } catch { return null }
  if (!body.exp || body.exp < Math.floor(Date.now() / 1000)) return null
  return body
}

export function authenticate(req, res, next) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  const payload = token && verifyToken(token)
  if (!payload) return res.status(401).json({ error: t(req, 'unauthorized') })
  req.user = { id: payload.sub, name: payload.name, email: payload.email, role: payload.role, tenant_id: payload.tenant_id }
  const override = req.headers['x-tenant-override']
  req.tenantId = req.user.role === 'super_admin' && override ? Number(override) : req.user.tenant_id
  next()
}

export function requireTenant(req, res, next) {
  if (!req.tenantId) return res.status(403).json({ error: t(req, 'tenantRequired') })
  next()
}

export function requireSuperAdmin(req, res, next) {
  if (req.user?.role !== 'super_admin') return res.status(403).json({ error: t(req, 'superAdminRequired') })
  next()
}

// TOTP (RFC 6238) implementado com node:crypto puro — sem dependência nova, mesmo padrão do resto do auth.js.
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function base32Encode(buffer) {
  let bits = ''
  for (const byte of buffer) bits += byte.toString(2).padStart(8, '0')
  let output = ''
  for (let i = 0; i + 5 <= bits.length; i += 5) output += BASE32_ALPHABET[parseInt(bits.slice(i, i + 5), 2)]
  if (bits.length % 5 !== 0) output += BASE32_ALPHABET[parseInt(bits.slice(-(bits.length % 5)).padEnd(5, '0'), 2)]
  return output
}

function base32Decode(base32) {
  let bits = ''
  for (const char of base32.toUpperCase().replace(/=+$/, '')) {
    const idx = BASE32_ALPHABET.indexOf(char)
    if (idx === -1) continue
    bits += idx.toString(2).padStart(5, '0')
  }
  const bytes = []
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2))
  return Buffer.from(bytes)
}

function hotp(secretBuffer, counter) {
  const counterBuf = Buffer.alloc(8)
  counterBuf.writeBigUInt64BE(BigInt(counter))
  const hmac = crypto.createHmac('sha1', secretBuffer).update(counterBuf).digest()
  const offset = hmac[hmac.length - 1] & 0xf
  const code = ((hmac[offset] & 0x7f) << 24 | (hmac[offset + 1] & 0xff) << 16 | (hmac[offset + 2] & 0xff) << 8 | (hmac[offset + 3] & 0xff)) % 1000000
  return String(code).padStart(6, '0')
}

export function generateTotpSecret() { return base32Encode(crypto.randomBytes(20)) }

export function totpUri(base32Secret, email) { return `otpauth://totp/OficinaPro:${encodeURIComponent(email)}?secret=${base32Secret}&issuer=OficinaPro` }

export function verifyTotp(base32Secret, token, window = 1) {
  if (!base32Secret || !token) return false
  const secretBuffer = base32Decode(base32Secret)
  const counter = Math.floor(Date.now() / 30000)
  for (let i = -window; i <= window; i++) if (hotp(secretBuffer, counter + i) === String(token)) return true
  return false
}
