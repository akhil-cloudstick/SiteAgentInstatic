/**
 * The one notifier: a webhook. Typed fields only — event, ticket, state, title,
 * time and a link — because notification content is itself an injection
 * source for whoever reads it. A failed delivery is logged and never fails the
 * write that caused it.
 */

import type { RelayEvent } from './types'

export async function sendWebhook(url: string, publicUrl: string, event: RelayEvent): Promise<void> {
  if (!url) return
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...event, link: publicUrl ? `${publicUrl}/t/${event.ticketId}` : null }),
    })
    if (!res.ok) console.warn(`relay notifier: webhook answered HTTP ${res.status}`)
  } catch (err) {
    console.warn(`relay notifier: ${err instanceof Error ? err.message : String(err)}`)
  }
}
