// Shared between the server action (regenerate) and the "new" page's
// initial server-rendered value -- not a 'use server' file since
// generatePromoCode() itself is synchronous.
const CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

export function generatePromoCode(): string {
  const group = () => Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('')
  return `${group()}-${group()}-${group()}`
}
