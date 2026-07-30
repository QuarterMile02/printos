// Shared styling for a table's rightmost "Actions" column, so it stays
// reachable when the table's content is wider than the visible viewport
// (rather than disappearing off-screen with zero indication there's more
// content to scroll to). Import these into any hand-rolled settings-page
// table that has a real Actions column with buttons — apply
// STICKY_ACTIONS_TH to the header <th> and STICKY_ACTIONS_TD to each body
// <td> in that column.
//
// Requires the table's scroll container to use overflow-x-auto (not
// overflow-hidden, which would clip content instead of allowing scroll)
// and each <tr> to carry the `group` class so STICKY_ACTIONS_TD's
// group-hover background tracks the row's own hover state.

export const STICKY_ACTIONS_TH =
  'sticky right-0 z-10 bg-gray-50 shadow-[-6px_0_6px_-6px_rgba(0,0,0,0.15)]'

export const STICKY_ACTIONS_TD =
  'sticky right-0 z-10 bg-white group-hover:bg-gray-50 shadow-[-6px_0_6px_-6px_rgba(0,0,0,0.15)]'
