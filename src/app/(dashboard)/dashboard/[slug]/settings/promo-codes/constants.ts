// Shared between page.tsx (server) and promo-codes-list-client.tsx (client).
// Must NOT be inside a 'use client' or 'use server' file.
export const PROMO_CODES_PAGE_SIZE = 50

// 'Percentage' is the only type confirmed present in ShopVOX's real data.
// Built as a list (not hardcoded to a single value) so a second type can be
// added later without restructuring the field -- unconfirmed whether
// ShopVOX also has a Fixed Amount type, so it's not included here yet.
export const PROMO_CODE_TYPES = ['Percentage']
