// In-process event store for Dialpad incoming calls.
// Events survive across requests within the same Node.js process.
// For multi-instance Vercel deployments, swap this for a Supabase row or Redis key.

export type CallEvent = {
  id: string
  timestamp: number        // Unix ms
  from_number: string      // normalized E.164
  matched: boolean
  customer_id?: string
  customer_name?: string
  customer_url?: string
}

const MAX_EVENTS = 50
let events: CallEvent[] = []

export function pushEvent(event: CallEvent): void {
  events = [event, ...events].slice(0, MAX_EVENTS)
}

export function getEventsSince(sinceMs: number): CallEvent[] {
  return events.filter((e) => e.timestamp > sinceMs)
}
