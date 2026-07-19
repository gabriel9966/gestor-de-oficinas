import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { hashPassword, verifyPassword, signToken, verifyToken, generateTotpSecret, verifyTotp, totpUri } from './auth.js'

test('hashPassword/verifyPassword: correct password matches, wrong does not', () => {
  const hash = hashPassword('minhaSenha123')
  assert.equal(verifyPassword('minhaSenha123', hash), true)
  assert.equal(verifyPassword('senhaErrada', hash), false)
})

test('hashPassword: two hashes of the same password are different (random salt)', () => {
  assert.notEqual(hashPassword('abc123'), hashPassword('abc123'))
})

test('signToken/verifyToken: round-trips payload and rejects tampering', () => {
  const token = signToken({ sub: 1, role: 'owner', tenant_id: 5 })
  const payload = verifyToken(token)
  assert.equal(payload.sub, 1)
  assert.equal(payload.role, 'owner')
  assert.equal(payload.tenant_id, 5)

  const tampered = token.slice(0, -2) + 'xx'
  assert.equal(verifyToken(tampered), null)
})

test('verifyToken: rejects malformed tokens', () => {
  assert.equal(verifyToken('not-a-token'), null)
  assert.equal(verifyToken(''), null)
  assert.equal(verifyToken(null), null)
})

test('TOTP: a freshly generated code for the current window verifies successfully', () => {
  const secret = generateTotpSecret()
  assert.match(secret, /^[A-Z2-7]+$/)
  // gera o código do jeito que um app autenticador faria, reaproveitando a lógica RFC 6238 local
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const decode = (b32) => {
    let bits = ''
    for (const c of b32.toUpperCase()) { const i = alphabet.indexOf(c); if (i !== -1) bits += i.toString(2).padStart(5, '0') }
    const bytes = []
    for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2))
    return Buffer.from(bytes)
  }
  const counter = Math.floor(Date.now() / 30000)
  const counterBuf = Buffer.alloc(8)
  counterBuf.writeBigUInt64BE(BigInt(counter))
  const hmac = crypto.createHmac('sha1', decode(secret)).update(counterBuf).digest()
  const offset = hmac[hmac.length - 1] & 0xf
  const code = ((hmac[offset] & 0x7f) << 24 | (hmac[offset + 1] & 0xff) << 16 | (hmac[offset + 2] & 0xff) << 8 | (hmac[offset + 3] & 0xff)) % 1000000
  const codeStr = String(code).padStart(6, '0')
  assert.equal(verifyTotp(secret, codeStr), true)
})

test('TOTP: wrong code is rejected', () => {
  const secret = generateTotpSecret()
  assert.equal(verifyTotp(secret, 'abcdef'), false)
  assert.equal(verifyTotp(null, '123456'), false)
  assert.equal(verifyTotp(secret, null), false)
})

test('totpUri: includes issuer and encoded email', () => {
  const uri = totpUri('SECRET123', 'a b@test.com')
  assert.match(uri, /^otpauth:\/\/totp\/OficinaPro:/)
  assert.match(uri, /issuer=OficinaPro/)
  assert.match(uri, /a%20b%40test\.com/)
})
