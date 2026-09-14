/**
 * The address the caller actually reached us on.
 *
 * Every URL this server hands back used to be written from its own point of
 * view — `http://127.0.0.1:8787`, `http://127.0.0.1:4400/invite/...`, a path
 * under `\\zaiserver\...`. All three are correct on this host and useless
 * everywhere else, which is exactly where the callers are: remote access
 * arrives over Tailscale and routes to the loopback listener, so the host in
 * the request is the only address known to work for the client.
 *
 * So rather than configuring a public base URL — a second thing to keep in
 * sync, and wrong the moment a route changes — every outbound URL is built
 * from the inbound request. Whatever address reached us round-trips back.
 *
 * `MMS_CONNECTOR_PUBLIC_URL` overrides it for the case the derivation cannot
 * cover: a proxy that terminates elsewhere and does not set `x-forwarded-host`.
 */

import { AsyncLocalStorage } from 'node:async_hooks'

export const PUBLIC_URL_ENV = 'MMS_CONNECTOR_PUBLIC_URL'

interface RequestContext {
  /** Origin the caller used, e.g. `http://zaiserver:8787`. No trailing slash. */
  baseUrl: string
  /** Mount prefix the proxy stripped, e.g. `/connector-mcp`. Empty when direct. */
  prefix: string
}

const storage = new AsyncLocalStorage<RequestContext>()

/** Derive the caller-facing origin from a request, honouring a proxy in front. */
export function originOf(req: Request): string {
  const configured = process.env[PUBLIC_URL_ENV]?.trim()
  if (configured) return configured.replace(/\/+$/, '')

  const url = new URL(req.url)
  // A proxy rewrites Host, so the forwarded pair is preferred where present.
  // Only the FIRST entry is ours: the rest were appended by hops further out
  // and naming one of those would send the caller somewhere we do not serve.
  const forwardedHost = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
  const forwardedProto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
  const host = forwardedHost || req.headers.get('host')?.trim() || url.host
  const proto = forwardedProto || url.protocol.replace(':', '')
  return `${proto}://${host}`.replace(/\/+$/, '')
}

/**
 * The mount prefix this server is reached under, as the caller sees it.
 *
 * We are behind a gateway that publishes us at `/connector-mcp` and strips that
 * before forwarding, so a request arrives looking like `/mcp` and every path we
 * know about is one prefix short of the truth. Getting the HOST right was not
 * enough: `https://gateway/exports/<id>` named a real file at an address the
 * gateway does not route, and 404ed.
 *
 * Normalised to either empty or a leading-slash-no-trailing-slash string, so
 * callers can concatenate without thinking about it.
 */
export function prefixOf(req: Request): string {
  const raw = req.headers.get('x-forwarded-prefix')?.split(',')[0]?.trim() ?? ''
  if (!raw || raw === '/') return ''
  return `/${raw.replace(/^\/+|\/+$/g, '')}`
}

/** Run `fn` with the caller-facing origin available to anything it calls. */
export function withRequestContext<T>(req: Request, fn: () => T): T {
  return storage.run({ baseUrl: originOf(req), prefix: prefixOf(req) }, fn)
}

/**
 * Origin plus mount prefix — the stem every URL we hand out must start with.
 *
 * This, rather than `callerBaseUrl()`, is what a link belongs on. The two differ
 * only behind a path-mounted proxy, and that is precisely the case that broke.
 */
export function callerRootUrl(): string | undefined {
  const store = storage.getStore()
  return store ? `${store.baseUrl}${store.prefix}` : undefined
}

/**
 * The caller-facing origin, or undefined outside a request.
 *
 * Undefined rather than a loopback default on purpose: a tool that cannot
 * build a reachable URL should say so, not hand back one that resolves to the
 * caller's own machine and fails with a connection error they will read as our
 * server being down.
 */
export function callerBaseUrl(): string | undefined {
  return storage.getStore()?.baseUrl
}

/**
 * Rewrite a URL this host generated so it points at the caller-facing address.
 *
 * The control plane mints invite links against its own `publicBaseUrl`, which
 * is loopback on this machine. The PORT is preserved — the control plane is a
 * different service on a different port — so this only replaces the hostname,
 * and only when the original is a loopback address. Anything already public is
 * left exactly as it is.
 */
export function reachableFrom(rawUrl: string): string {
  const base = callerBaseUrl()
  if (!base) return rawUrl
  try {
    const target = new URL(rawUrl)
    const isLoopback =
      target.hostname === '127.0.0.1' ||
      target.hostname === 'localhost' ||
      target.hostname === '::1' ||
      target.hostname === '0.0.0.0'
    if (!isLoopback) return rawUrl
    target.hostname = new URL(base).hostname
    return target.toString()
  } catch {
    return rawUrl
  }
}
