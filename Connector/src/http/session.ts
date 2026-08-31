/**
 * Session handling against an Instatic host.
 *
 * Three things here are not obvious and each one costs an afternoon if missed:
 *
 * 1. **Send no `Origin` header.** State-changing CMS calls run through a CSRF
 *    origin gate. A request with no Origin is treated as server-to-server and
 *    allowed; a request with the *wrong* Origin is a flat 403. Since we are a
 *    CLI, omitting it is both correct and simplest.
 *
 * 2. **Step-up rotates the session cookie.** Destructive operations (full-site
 *    publish, `replace` import) require a fresh step-up challenge, and the
 *    response hands back a NEW cookie. Keep using the old one and every
 *    subsequent call fails in a way that looks like the step-up did not work.
 *
 * 3. **The route prefix is not guessable.** It differs between this fork and
 *    public upstream, so it is configuration, never a constant compiled in.
 */

export interface SessionOptions {
  /** e.g. https://siteagent.tailbbb0d2.ts.net */
  baseUrl: string
  /** e.g. /cms/api/cms — differs between forks, so it is passed in. */
  apiPrefix: string
}

export class InstaticHttpError extends Error {
  override readonly name = 'InstaticHttpError'
  readonly status: number
  readonly body: string
  constructor(status: number, body: string, context: string) {
    super(`${context} failed: HTTP ${status} ${body.slice(0, 300)}`)
    this.status = status
    this.body = body
  }
}

export class InstaticSession {
  private cookie: string | null = null
  private readonly baseUrl: string
  private readonly apiPrefix: string

  constructor(options: SessionOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '')
    this.apiPrefix = options.apiPrefix.replace(/\/$/, '')
  }

  get authenticated(): boolean {
    return this.cookie !== null
  }

  private url(path: string): string {
    return `${this.baseUrl}${this.apiPrefix}${path}`
  }

  /** Capture the session cookie from a Set-Cookie response header. */
  private captureCookie(res: Response): void {
    const setCookie = res.headers.get('set-cookie')
    if (!setCookie) return
    const match = /instatic_admin_session=([^;]+)/.exec(setCookie)
    if (match) this.cookie = `instatic_admin_session=${match[1]}`
  }

  async request(
    path: string,
    init: RequestInit & { context?: string } = {},
  ): Promise<Response> {
    const { context = path, ...rest } = init
    const headers = new Headers(rest.headers)
    if (this.cookie) headers.set('cookie', this.cookie)
    // Note the absence of an Origin header — see the note at the top.
    const res = await fetch(this.url(path), { ...rest, headers, redirect: 'manual' })
    this.captureCookie(res)
    if (!res.ok) throw new InstaticHttpError(res.status, await res.text(), context)
    return res
  }

  async login(email: string, secret: string, mfaCode?: string): Promise<void> {
    const body: Record<string, string> = { email, password: secret }
    if (mfaCode) body.code = mfaCode
    const res = await this.request('/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      context: 'login',
    })
    this.captureCookie(res)
    if (!this.cookie) {
      throw new Error(
        'Login returned 200 but no session cookie was set. If this account has MFA ' +
          'enabled, a code is required.',
      )
    }
  }

  /**
   * Re-authenticate for a destructive operation. The rotated cookie replaces the
   * current one — that replacement is the whole point of calling this.
   */
  async stepUp(secret: string, mfaCode?: string): Promise<void> {
    const body: Record<string, string> = { password: secret }
    if (mfaCode) body.code = mfaCode
    await this.request('/auth/step-up', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      context: 'step-up',
    })
  }
}
