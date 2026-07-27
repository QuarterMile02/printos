// Shared between page.tsx (server) and quotes-list-client.tsx (client).
// Must NOT be inside a 'use client' file — server components cannot safely
// import named exports from client modules in all Next.js versions.
export const QUOTES_PAGE_SIZE = 50
