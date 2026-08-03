import crypto from 'crypto'

// AES-256-GCM encryption for credentials stored at rest (carrier_connections.credentials,
// payment_gateway_settings.api_login_id/transaction_key). Single app-level key from the
// CREDENTIAL_ENCRYPTION_KEY env var (not per-org) -- same pattern as every other secret
// in this codebase (EASYPOST_API_KEY, SUPABASE_SERVICE_ROLE_KEY): a single Vercel env
// var read directly via process.env at point of use, no central env-schema library.
// No route in this repo runs on Edge, so Node's built-in `crypto` needs no polyfill.

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12        // GCM standard nonce size
const AUTH_TAG_LENGTH = 16
const KEY_LENGTH = 32       // AES-256

function getKey(): Buffer {
  const raw = process.env.CREDENTIAL_ENCRYPTION_KEY
  if (!raw) throw new Error('CREDENTIAL_ENCRYPTION_KEY is not configured')
  const key = Buffer.from(raw, 'base64')
  if (key.length !== KEY_LENGTH) throw new Error(`CREDENTIAL_ENCRYPTION_KEY must decode to exactly ${KEY_LENGTH} bytes (base64)`)
  return key
}

// Encoded as base64(iv || authTag || ciphertext) -- one opaque string, so it drops into
// the existing text columns / jsonb string values with no schema change.
export function encryptCredential(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64')
}

export function decryptCredential(encoded: string): string {
  const buf = Buffer.from(encoded, 'base64')
  const iv = buf.subarray(0, IV_LENGTH)
  const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH)
  const ciphertext = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH)
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}

// Best-effort "is this value already in our encrypted format" check. GCM's auth tag
// means a value that ISN'T genuinely ciphertext from this key will fail decryption
// with overwhelming probability (tag verification), so this doubles as:
//   1. The migration script's idempotency check (skip fields already encrypted).
//   2. The read-path's plaintext/ciphertext auto-detection, so the decrypting code can
//      be deployed before the data migration runs (and the migration run after) without
//      a window where live values are unreadable either way.
export function isEncryptedCredential(value: string): boolean {
  if (!value) return false
  try {
    const buf = Buffer.from(value, 'base64')
    if (buf.length < IV_LENGTH + AUTH_TAG_LENGTH + 1) return false
    decryptCredential(value)
    return true
  } catch {
    return false
  }
}

// Decrypts if the value is in our encrypted format, otherwise returns it unchanged.
// Used at the one real read-for-use call site (easypost.ts) so it works correctly
// whether or not the one-time migration has run yet against a given row.
export function decryptCredentialTolerant(value: string): string {
  return isEncryptedCredential(value) ? decryptCredential(value) : value
}
