// Shared between page.tsx (server) and discounts-list-client.tsx (client).
// Must NOT be inside a 'use client' or 'use server' file.
export const DISCOUNTS_PAGE_SIZE = 50
export const DISCOUNT_TYPES = ['Range', 'Volume', 'Price']
export const DISCOUNT_APPLIES_TO = ['Product', 'Material', 'Both']
