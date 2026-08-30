// Shared between page.tsx (server) and vendors-list-client.tsx (client).
// Must NOT be inside a 'use client' file — server components cannot safely
// import named exports from client modules in all Next.js versions.
// Mirrors customers/constants.ts exactly (same PAGE_SIZE convention).
export const VENDORS_PAGE_SIZE = 25
