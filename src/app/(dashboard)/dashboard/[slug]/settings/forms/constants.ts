// Plain, directive-free module — the fixed list of form types ShopVOX's
// own Forms settings page configures (Settings > Forms), matched 1:1 by
// key. Shared between the list page (server) and the detail page/client
// (server + client) — same class of pitfall documented in
// jobs-list-constants.ts/board-config.ts, so this file carries neither
// 'use client' nor 'use server'.
//
// Customer/material/product were seeded in migration 125; sales_order/
// purchase_order/job/vendor/quote/sales_lead were added in migration
// 126 once their real field counts were re-confirmed against the
// actual current PrintOS forms (not assumed from the original rough
// estimate — several came out thinner or richer than expected, see
// 126's header comment for the per-type breakdown).
//
// Invoice is the one form intentionally left unseeded: it has zero
// genuinely toggleable fields. There is no create/edit form for an
// invoice at all — it's generated 100% programmatically off a Sales
// Order, and its only user interaction (Record Payment) is a derived
// increment, not a settable field. It will correctly show "Not
// configured yet" indefinitely unless PrintOS ever grows a real
// invoice edit form.

export type FormTypeKey =
  | 'customer'
  | 'invoice'
  | 'job'
  | 'material'
  | 'product'
  | 'purchase_order'
  | 'quote'
  | 'sales_lead'
  | 'sales_order'
  | 'vendor'

export const FORM_TYPES: { key: FormTypeKey; label: string }[] = [
  { key: 'customer', label: 'Customer' },
  { key: 'invoice', label: 'Invoice' },
  { key: 'job', label: 'Job' },
  { key: 'material', label: 'Material' },
  { key: 'product', label: 'Product' },
  { key: 'purchase_order', label: 'Purchase Order' },
  { key: 'quote', label: 'Quote' },
  { key: 'sales_lead', label: 'Sales Lead' },
  { key: 'sales_order', label: 'Sales Order' },
  { key: 'vendor', label: 'Vendor' },
]
