import { t } from './i18n.js'

const WINDOW_MS = 15 * 60 * 1000
const MAX_ATTEMPTS = 10
const attempts = new Map()

setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of attempts) if (now - entry.firstAt > WINDOW_MS) attempts.delete(key)
}, WINDOW_MS)

export function loginLimiter(req, res, next) {
  const key = `${req.ip}:${String(req.body?.email || '').toLowerCase()}`
  const now = Date.now()
  const entry = attempts.get(key)
  if (!entry || now - entry.firstAt > WINDOW_MS) {
    attempts.set(key, { count: 1, firstAt: now })
    return next()
  }
  entry.count++
  if (entry.count > MAX_ATTEMPTS) return res.status(429).json({ error: t(req, 'tooManyAttempts') })
  next()
}
