/**
 * Server-rendered pages: the queue and one ticket.
 *
 * Every string that came from a request is escaped — ticket text and message
 * bodies are untrusted input by the partner plan's own definition. Pages carry
 * a per-response CSP nonce, so an injected `<script>` would not run even if an
 * escape were ever missed.
 *
 * The owner's GO screen shows the validator's evidence blocks and nothing else
 * up front. The partner plan is explicit that a GO is granted on evidence,
 * never on a summary; the full thread is still there, collapsed and labelled.
 */

import { simpleMovesFor } from './state'
import type { Actor, GoRecord, Message, Ticket, TransitionRecord } from './types'

export interface Page {
  html: string
  nonce: string
}

interface PageContext {
  actor: Actor
  ownerKeyFingerprint: string | null
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
export const esc = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]!)

const CSS = `
:root{--bg:#f7f6f2;--fg:#1d1d1b;--muted:#6b6a64;--line:#dedbd2;--card:#fff;--ok:#1f7a3f;--bad:#b3261e;--warn:#8a5a00;--accent:#2b4c7e}
@media (prefers-color-scheme:dark){:root{--bg:#161614;--fg:#ecebe6;--muted:#a3a29b;--line:#34332f;--card:#1f1f1c;--ok:#5cc88a;--bad:#f2867e;--warn:#e6b450;--accent:#8fb0e6}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
a{color:var(--accent)}
.top{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;padding:10px 16px;border-bottom:1px solid var(--line);background:var(--card)}
.brand{font-weight:700;color:var(--fg);text-decoration:none}
.who{padding:0 8px;border:1px solid var(--line);border-radius:10px;color:var(--muted)}
.key{margin-left:auto;color:var(--muted)}
main{max-width:980px;margin:0 auto;padding:16px}
h1{font-size:20px;margin:4px 0 8px}h2{font-size:15px;margin:0 0 8px}
.wrap{overflow-x:auto}
table{width:100%;border-collapse:collapse;background:var(--card)}
th,td{text-align:left;padding:8px;border-bottom:1px solid var(--line);vertical-align:top}
code,pre,textarea{font-family:ui-monospace,Consolas,monospace;font-size:12px}
pre{white-space:pre-wrap;word-break:break-word;margin:0}
code{word-break:break-all}
.badge{display:inline-block;padding:0 8px;border-radius:10px;border:1px solid var(--line);font-size:12px}
.state-confirmed,.state-done,.verdict-confirmed .badge{color:var(--ok)}
.state-refuted,.state-failed,.state-revoked,.state-refused,.state-expired,.verdict-refuted .badge{color:var(--bad)}
.stalled,.state-disputed,.verdict-abstain .badge{color:var(--warn)}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px 14px;margin:12px 0}
.meta{color:var(--muted)}
dl{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:4px 12px;margin:8px 0 0}
dt{color:var(--muted)}dd{margin:0;min-width:0}
.evidence{border-left:3px solid var(--line);padding-left:10px;margin:10px 0}
.reply{margin-left:24px}
textarea{width:100%;min-height:150px;padding:8px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg)}
button{font:inherit;padding:6px 12px;border-radius:6px;border:1px solid var(--line);background:var(--card);color:var(--fg);cursor:pointer}
button.primary{background:var(--accent);border-color:var(--accent);color:#fff}
.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
summary{cursor:pointer}
@media (max-width:600px){dl{grid-template-columns:minmax(0,1fr)}.key{margin-left:0}.reply{margin-left:10px}}
`

const SCRIPT = `
const id = document.body.dataset.ticket;
const result = document.getElementById('action-result');
async function post(path, body) {
  result.textContent = 'Sending...';
  try {
    const res = await fetch('/api/tickets/' + encodeURIComponent(id) + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) { result.textContent = 'Done. Reloading...'; setTimeout(() => location.reload(), 600); }
    else { result.textContent = data.error || ('HTTP ' + res.status); }
  } catch (err) { result.textContent = 'Network error: ' + err.message; }
}
const goButton = document.getElementById('go-submit');
if (goButton) goButton.addEventListener('click', () => {
  let go;
  try { go = JSON.parse(document.getElementById('go-json').value); }
  catch { result.textContent = 'The GO is not valid JSON.'; return; }
  post('/go', { go });
});
document.querySelectorAll('button[data-to]').forEach((button) => {
  button.addEventListener('click', () => {
    if (confirm(button.dataset.confirm)) post('/transition', { to: button.dataset.to });
  });
});
`

const MOVE_LABELS: Record<string, string> = {
  refused: 'Refuse GO',
  revoked: 'Revoke GO',
  executing: 'Mark executing',
  failed: 'Mark failed',
  disputed: 'Dispute',
  validating: 'Back to validating',
  confirmed: 'Decide: confirmed',
  refuted: 'Decide: refuted',
  done: 'Decide: done',
}

function shell(title: string, content: string, ctx: PageContext, options: { script?: boolean; ticketId?: string } = {}): Page {
  const nonce = crypto.randomUUID().replace(/-/g, '')
  const key = ctx.ownerKeyFingerprint
    ? `GO enforced · owner key <code>${esc(ctx.ownerKeyFingerprint)}</code>`
    : '<strong class="stalled">No owner key configured — no GO can be granted</strong>'
  const html =
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<title>${esc(title)} · Deploy Relay</title><style nonce="${nonce}">${CSS}</style></head>` +
    `<body${options.ticketId ? ` data-ticket="${esc(options.ticketId)}"` : ''}>` +
    `<header class="top"><a class="brand" href="/">Deploy Relay</a><span class="who">${esc(ctx.actor.role)}</span>` +
    `<span class="key">${key}</span></header><main>${content}</main>` +
    (options.script ? `<script nonce="${nonce}">${SCRIPT}</script>` : '') +
    '</body></html>'
  return { html, nonce }
}

const stateBadge = (t: Ticket): string =>
  `<span class="badge state-${esc(t.state)}">${esc(t.state)}</span>` +
  (t.validatorStalled ? ' <span class="badge stalled">validator stalled</span>' : '')

const artefactLink = (sha256: string): string =>
  `<a href="/api/artefacts/${esc(sha256)}"><code>${esc(sha256)}</code></a>`

export function renderQueue(ctx: PageContext & { tickets: Ticket[] }): Page {
  const rows = ctx.tickets
    .map(
      (t) =>
        `<tr><td><a href="/t/${esc(t.id)}">${esc(t.id)}</a></td><td>${esc(t.type)}</td>` +
        `<td>${esc(t.title)}</td><td>${stateBadge(t)}</td><td class="meta">${esc(t.updatedAt)}</td></tr>`,
    )
    .join('')
  const content =
    '<h1>Queue</h1>' +
    (ctx.tickets.length > 0
      ? '<div class="wrap"><table><thead><tr><th>Ticket</th><th>Type</th><th>Title</th><th>State</th>' +
        `<th>Updated</th></tr></thead><tbody>${rows}</tbody></table></div>`
      : '<p class="meta">No tickets yet.</p>')
  return shell('Queue', content, ctx)
}

function evidenceBlock(m: Message): string {
  const e = m.evidence
  if (!e) return ''
  return (
    `<section class="evidence verdict-${esc(e.verdict)}">` +
    `<div><span class="badge">${esc(e.verdict)}</span> <span class="meta">${esc(m.id)} · ${esc(m.createdAt)}</span></div>` +
    '<dl>' +
    `<dt>Claim</dt><dd>${esc(e.claim)}</dd>` +
    `<dt>Prediction (recorded first)</dt><dd>${esc(e.prediction)}</dd>` +
    `<dt>Artefacts</dt><dd>${e.artefacts.map((a) => `<code>${esc(a)}</code>`).join('<br>')}</dd>` +
    `<dt>Commands</dt><dd><pre>${esc(e.commands.join('\n'))}</pre></dd>` +
    `<dt>Output</dt><dd><pre>${esc(e.output)}</pre></dd>` +
    `<dt>Could not see</dt><dd>${esc(e.blindSpots)}</dd>` +
    '</dl></section>'
  )
}

function messageCard(m: Message): string {
  return (
    `<article class="card${m.replyTo ? ' reply' : ''}">` +
    `<div class="meta">${esc(m.id)} · ${esc(m.author)} · ${esc(m.kind)} · ${esc(m.createdAt)}` +
    `${m.replyTo ? ` · reply to ${esc(m.replyTo)}` : ''}</div>` +
    (m.body ? `<pre>${esc(m.body)}</pre>` : '') +
    evidenceBlock(m) +
    (m.artefacts.length > 0 ? `<div class="meta">Artefacts: ${m.artefacts.map(artefactLink).join(' ')}</div>` : '') +
    '</article>'
  )
}

function goPanel(ctx: PageContext & { ticket: Ticket; go: GoRecord | null; now: Date }, evidence: Message[]): string {
  const { ticket: t, go } = ctx

  if (ctx.actor.role === 'owner' && t.state === 'awaiting_go') {
    const command =
      `bun cli/sign-go.ts sign --key <your key file> --ticket ${t.id} --action ${t.action} ` +
      `--target ${t.target} --sha256 ${t.sha256}` +
      (t.contentDigest ? ` --content-digest ${t.contentDigest}` : '')
    return (
      '<section class="card"><h2>Grant GO</h2>' +
      '<p class="meta">What the validator measured — evidence blocks only, never a summary.</p>' +
      (evidence.length > 0
        ? evidence.map(evidenceBlock).join('')
        : '<p class="stalled">No evidence has been posted on this deploy-request.</p>') +
      `<p>Sign on your own machine:</p><pre>${esc(command)}</pre>` +
      '<p><label for="go-json">Paste the GO it prints</label></p>' +
      '<textarea id="go-json" spellcheck="false" placeholder="{ &quot;ticketId&quot;: ... }"></textarea>' +
      '<div class="actions"><button type="button" id="go-submit" class="primary">Record GO</button></div>' +
      '</section>'
    )
  }

  if (!go) return '<section class="card"><h2>GO</h2><p class="meta">No GO has been granted.</p></section>'

  const expired = Date.parse(go.go.expiresAt) <= ctx.now.getTime()
  return (
    '<section class="card"><h2>GO</h2><dl>' +
    `<dt>Granted</dt><dd>${esc(go.grantedAt)}</dd>` +
    `<dt>Expires</dt><dd>${esc(go.go.expiresAt)}${expired ? ' <span class="badge state-expired">expired</span>' : ''}</dd>` +
    `<dt>Nonce</dt><dd><code>${esc(go.go.nonce)}</code></dd>` +
    `<dt>Owner key</dt><dd><code>${esc(go.ownerKeyFingerprint)}</code></dd>` +
    `<dt>Consumed</dt><dd>${go.consumedAt ? esc(go.consumedAt) : 'not yet'}</dd>` +
    '</dl></section>'
  )
}

export function renderTicket(
  ctx: PageContext & {
    ticket: Ticket
    messages: Message[]
    transitions: TransitionRecord[]
    go: GoRecord | null
    now: Date
  },
): Page {
  const { ticket: t, actor } = ctx
  const evidence = ctx.messages.filter((m) => m.kind === 'evidence' && m.evidence)
  const moves = simpleMovesFor(t.type, t.state, actor.role).filter((r) => !(r.to === 'disputed' && t.adjudicated))
  const goScreen = actor.role === 'owner' && t.type === 'deploy-request' && t.state === 'awaiting_go'

  const facts =
    '<dl>' +
    `<dt>Type</dt><dd>${esc(t.type)}</dd>` +
    `<dt>State</dt><dd>${stateBadge(t)}</dd>` +
    `<dt>Opened</dt><dd>${esc(t.createdBy)} · ${esc(t.createdAt)}</dd>` +
    (t.type === 'deploy-request'
      ? `<dt>Action</dt><dd>${esc(t.action)}</dd><dt>Target</dt><dd>${esc(t.target)}</dd>` +
        `<dt>sha256</dt><dd>${t.sha256 ? (t.action === 'publish-row' || t.action?.startsWith('set-status') || t.action === 'delete' ? `<code>${esc(t.sha256)}</code> <span class="meta">rows digest</span>` : artefactLink(t.sha256)) : ''}</dd>` +
        (t.contentDigest ? `<dt>Draft site digest</dt><dd><code>${esc(t.contentDigest)}</code></dd>` : '') +
        (t.deployId ? `<dt>Deploy id</dt><dd><code>${esc(t.deployId)}</code></dd>` : '')
      : '') +
    (t.artefacts.length > 0 ? `<dt>Artefacts</dt><dd>${t.artefacts.map(artefactLink).join('<br>')}</dd>` : '') +
    '</dl>'

  const actions =
    moves.length > 0
      ? '<div class="actions">' +
        moves
          .map(
            (r) =>
              `<button type="button" data-to="${esc(r.to)}" data-confirm="${esc(`Move ${t.id} to ${r.to}?`)}">` +
              `${esc(MOVE_LABELS[r.to] ?? r.to)}</button>`,
          )
          .join('') +
        '</div>'
      : ''

  const thread = ctx.messages.length > 0 ? ctx.messages.map(messageCard).join('') : '<p class="meta">No messages.</p>'
  const threadSection = goScreen
    ? `<details class="card"><summary>Full thread (${ctx.messages.length}) — comments are not evidence</summary>${thread}</details>`
    : `<section class="card"><h2>Thread</h2>${thread}</section>`

  const history =
    ctx.transitions.length > 0
      ? '<section class="card"><h2>History</h2><div class="wrap"><table><tbody>' +
        ctx.transitions
          .map(
            (tr) =>
              `<tr><td class="meta">${esc(tr.at)}</td><td>${esc(tr.from)} → ${esc(tr.to)}</td><td>${esc(tr.by)}</td>` +
              `<td>${tr.evidenceMessageId ? esc(tr.evidenceMessageId) : ''}${tr.deployId ? ` <code>${esc(tr.deployId)}</code>` : ''}</td></tr>`,
          )
          .join('') +
        '</tbody></table></div></section>'
      : ''

  const interactive = moves.length > 0 || goScreen
  const content =
    `<p class="meta"><a href="/">Queue</a></p><h1>${esc(t.id)} · ${esc(t.title)}</h1>` +
    `<section class="card">${facts}${t.body ? `<pre>${esc(t.body)}</pre>` : ''}${actions}` +
    `${interactive ? '<p id="action-result" class="meta" role="status"></p>' : ''}</section>` +
    (t.type === 'deploy-request' ? goPanel(ctx, evidence) : '') +
    threadSection +
    history

  return shell(t.id, content, ctx, { script: interactive, ticketId: t.id })
}
