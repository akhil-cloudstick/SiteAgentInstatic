/**
 * The one notifier: a webhook.
 *
 * The body is shaped for the receiver, because a chat service silently drops
 * what it cannot parse — a valid webhook and a 400 look identical from here,
 * which is exactly how a notifier ends up "wired and silent". Discord and Slack
 * are recognised by their hostname and get the body each expects; anything else
 * keeps the typed event object, which is what a status page or a bridge wants.
 *
 * Content stays ids, roles and states — never a message body. The one piece of
 * free text is the ticket title, which is written by whoever opened the ticket:
 * it is flattened to one line, stripped of anything that renders as markup or a
 * mention, and truncated. Discord additionally gets `allowed_mentions: []`, so
 * a ticket title can never page a channel.
 *
 * A failed delivery is logged and never fails the write that caused it.
 */

import type { RelayEvent } from './types'

export type NotifyShape = 'discord' | 'slack' | 'json'

const DISCORD_HOSTS = ['discord.com', 'discordapp.com']
const SLACK_HOSTS = ['hooks.slack.com']

const hostMatches = (host: string, allowed: string[]): boolean =>
  allowed.some((known) => host === known || host.endsWith(`.${known}`))

/** Which body the receiver at this URL understands. */
export function shapeFor(url: string): NotifyShape {
  try {
    const host = new URL(url).hostname.toLowerCase()
    if (hostMatches(host, DISCORD_HOSTS)) return 'discord'
    if (hostMatches(host, SLACK_HOSTS)) return 'slack'
  } catch {
    // Not a URL: `sendWebhook` will fail on it and log, which is the right place.
  }
  return 'json'
}

/** One line of a ticket title: no line breaks, no markup, no mentions, bounded length. */
function plainTitle(raw: string): string {
  const oneLine = String(raw ?? '').replace(/\s+/g, ' ').trim()
  const stripped = oneLine.replace(/[`*_~|<>@#]/g, '')
  return stripped.length > 120 ? `${stripped.slice(0, 119)}…` : stripped
}

/** The human-readable line a chat receiver shows: ids, who, what, where. */
export function summaryLine(event: RelayEvent, link: string | null): string {
  const message = event.messageId ? ` ${event.messageId}` : ''
  const who = event.author ? ` by ${event.author}` : ''
  const kind = event.kind ? ` (${event.kind})` : ''
  return [
    `${event.event}: ${event.ticketId}${message}${who}${kind}`,
    `state ${event.state}`,
    plainTitle(event.title),
    link,
  ]
    .filter(Boolean)
    .join(' · ')
}

/** The body to POST, shaped for whatever is listening at `url`. */
export function notifyBody(url: string, event: RelayEvent, publicUrl: string): unknown {
  const link = publicUrl ? `${publicUrl}/t/${event.ticketId}` : null
  switch (shapeFor(url)) {
    case 'discord':
      return { content: summaryLine(event, link), allowed_mentions: { parse: [] } }
    case 'slack':
      return { text: summaryLine(event, link) }
    default:
      return { ...event, link }
  }
}

export async function sendWebhook(url: string, publicUrl: string, event: RelayEvent): Promise<void> {
  if (!url) return
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(notifyBody(url, event, publicUrl)),
    })
    // A chat service answers 400 for a body it cannot parse and shows nothing,
    // so the status is worth naming rather than "delivery failed".
    if (!res.ok) console.warn(`relay notifier: ${shapeFor(url)} webhook answered HTTP ${res.status}`)
  } catch (err) {
    console.warn(`relay notifier: ${err instanceof Error ? err.message : String(err)}`)
  }
}
