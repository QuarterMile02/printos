// Plain, directive-free module — the fixed list of form types ShopVOX's
// own Forms settings page configures (Settings > Forms), matched 1:1 by
// key. Shared between the list page (server) and the detail page/client
// (server + client) — same class of pitfall documented in
// jobs-list-constants.ts/board-config.ts, so this file carries neither
// 'use client' nor 'use server'.
//
// Only customer/material/product have seed data as of migration 125 —
// the rest render an empty "Not configured yet" state until a later
// seed pass (see the field-mapping report: Invoice/Purchase Order/Job/
// Sales Order/Vendor/Quote/Sales Lead all had too little real PrintOS
// field coverage to seed meaningfully in this batch).

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
