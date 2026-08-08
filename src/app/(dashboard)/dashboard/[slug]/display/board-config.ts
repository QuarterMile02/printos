// Plain, static config for the Display Board — deliberately NOT in
// actions.ts. actions.ts has 'use server' at the top, which means the
// whole file is a Server Actions module; React's server-functions
// transform requires every export of a 'use server' file to be an async
// function, since each export becomes a callable reference the client
// re-invokes over the network. CREW_BOARDS/MANAGEMENT_UNITS lived there
// as plain constants, which isn't a valid Server Function export shape.
//
// That's not a lint nitpick -- it's what was actually crashing
// /dashboard/[slug]/display in production. Both ManagementBoard.tsx and
// DepartmentBoard.tsx import these client-side; on the client, an
// invalid non-function export off a 'use server' module doesn't resolve
// to the real object, so `Object.values(CREW_BOARDS).flatMap(...)` in
// ManagementBoard's module-level ALL_CODES computation threw
// "n.flatMap is not a function" the instant the page's client bundle
// loaded -- before any component even rendered, hence the hard
// "This page couldn't load" instead of a partial render.
//
// Fix: this is genuinely just data, not server logic. It belongs in its
// own plain module with no directive, importable identically from server
// and client code.

export const CREW_BOARDS = {
  design: {
    label: 'DESIGN',
    codes: ['design', 'branding'],
    urlParam: 'design',
  },
  large_format: {
    label: 'LARGE FORMAT',
    codes: ['large_format'],
    urlParam: 'large_format',
  },
  commercial: {
    label: 'COMMERCIAL',
    codes: ['commercial_print', 'direct_mail'],
    urlParam: 'commercial',
  },
  installation: {
    label: 'INSTALLATION',
    codes: ['installation', 'vehicle_wrap', 'service_repair', 'channel_letters', 'fabrication'],
    urlParam: 'installation',
  },
  digital: {
    label: 'DIGITAL',
    codes: ['digital_marketing', 'digital_screens'],
    urlParam: 'digital',
  },
} as const

export const MANAGEMENT_UNITS = [
  { label: 'LARGE FORMAT',      codes: ['large_format'],                               color: '#93ca3b' },
  { label: 'ILLUMINATED SIGNS', codes: ['channel_letters', 'fabrication'],             color: '#F59E0B' },
  { label: 'COMMERCIAL',        codes: ['commercial_print', 'direct_mail'],            color: '#3B82F6' },
  { label: 'VEHICLE WRAPS',     codes: ['vehicle_wrap'],                               color: '#8B5CF6' },
  { label: 'BRANDING',          codes: ['branding', 'design'],                         color: '#EC4899' },
  { label: 'DIGITAL',           codes: ['digital_marketing', 'digital_screens'],       color: '#06B6D4' },
  { label: 'PROMOTIONAL',       codes: ['promotional'],                                color: '#F97316' },
  { label: 'APPAREL',           codes: ['apparel'],                                    color: '#EF4444' },
] as const
