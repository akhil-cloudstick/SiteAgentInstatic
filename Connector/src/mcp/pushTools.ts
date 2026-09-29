/**
 * The push, driven by the machine door (MMSBUILD R13).
 *
 * The milestone this phase is measured by is a number: "a full push of a new
 * site completes end-to-end with developer round-trip count = 0". Today that
 * count is thirteen — not because any step is hard, but because the steps are
 * strung together by a person who knows what comes next. This is that person,
 * written down.
 *
 * The sequence is the one PRD 5.4 names: pre-flight, import under approval,
 * inspect, publish under a second approval. The studio asks for it; the owner
 * signs twice; the validator judges the result. Nothing in between needs anybody.
 *
 * TWO DESIGN POINTS THAT MATTER MORE THAN THE REST:
 *
 * 1. This drives the existing tools rather than reimplementing them. Every step
 *    goes THROUGH `connector_import_replace` and `connector_publish_site`, so it
 *    passes the same pre-flight and the same GO gate a person would hit. An
 *    orchestrator that called the CMS directly would be a way around the gates,
 *    and a way around a gate is the same as not having one — the loop would be
 *    the most privileged caller in the system rather than the most ordinary.
 *
 * 2. It never blocks waiting for a person. A push waits for two human
 *    signatures, which take as long as they take. Each call advances the run as
 *    far as it can and then reports what it is waiting for, and a sweeper picks
 *    parked runs back up once the owner has signed (see `startPushSweeper` at
 *    the bottom of this file). A loop that slept until an owner signed would
 *    hold a connection for hours and lose the run to the first restart.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import type { ConnectorTool, ToolResult } from './tools'
import { CRUD_TOOLS } from './crudTools'
import { IMPORT_TOOLS } from './importTools'
// connector_publish_rows lives here, and the push loop needs it: the row publish
// is a step of the run, not an administrator's separate errand.
import { ADMIN_TOOLS } from './adminTools'
import { moveRelayTicket, openRelayDeployRequest, postRelayMessage, readRelayGo, readRelayTicket } from '../http/relay'
import { resolveTarget } from '../http/config'
import { requireSession } from '../http/store'
import { stepUp } from '../http/admin'

export const PUSH_DIR_ENV = 'MMS_CONNECTOR_PUSH_DIR'

const ok = (value: unknown): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
})
const fail = (message: string, detail?: unknown): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify({ error: message, detail }, null, 2) }],
  isError: true,
})
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/**
 * Where a run is kept between calls.
 *
 * On disk rather than in memory, because the wait for an owner outlives the
 * process: a restart in the middle of a push must not lose which ticket it was
 * waiting on and open a second one.
 */
function pushDir(): string {
  const configured = process.env[PUSH_DIR_ENV]?.trim()
  const dir = configured ? resolve(configured) : resolve(import.meta.dir, '../../.tmp/pushes')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export type PushStep =
  | 'preflight'
  | 'awaiting-import-go'
  | 'importing'
  | 'inspect'
  // A site publish bakes the pages and the entry template and leaves collection
  // rows as drafts — documented behaviour ("publishing a row does not deploy it;
  // plan publish-rows then publish-site"), and the reason the first full
  // acceptance run put a site live with 8 of its 18 URLs serving the homepage.
  // The rows are published inside the run now, under their own GO, BEFORE the
  // site publish, because the site publish is what bakes their pages.
  | 'awaiting-rows-go'
  | 'publishing-rows'
  | 'awaiting-publish-go'
  | 'publishing'
  | 'done'
  | 'refused'

export interface PushState {
  id: string
  target: string
  title: string
  step: PushStep
  source: { relaySha256?: string; uploadId?: string; path?: string }
  sha256?: string
  importTicketId?: string
  rowsTicketId?: string
  publishTicketId?: string
  /** The rows this run is publishing, and the digest their GO is bound to. */
  rows?: { ids: string[]; digest: string }
  startedAt: string
  updatedAt: string
  /** Every step this run has taken, so the record is the run's own account. */
  history: { at: string; step: PushStep; note: string }[]
  refusal?: string
  evidence?: Record<string, unknown>
}

const statePath = (id: string): string => resolve(pushDir(), `${id}.json`)

function loadPush(id: string): PushState | null {
  const file = statePath(id)
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as PushState
  } catch {
    return null
  }
}

function savePush(state: PushState): PushState {
  state.updatedAt = new Date().toISOString()
  writeFileSync(statePath(state.id), JSON.stringify(state, null, 2))
  return state
}

function note(state: PushState, step: PushStep, text: string): void {
  state.step = step
  state.history.push({ at: new Date().toISOString(), step, note: text })
}

/**
 * Every collection row on the target that is not published.
 *
 * Read from the TARGET, not from the bundle. After a replace import the CMS is
 * the only thing that knows which row ids exist and what status each one carries,
 * and the rows GO is bound to a digest of those ids — so inferring them from the
 * bundle would bind an approval to a set that might not be what is there.
 *
 * `pages` is excluded because the page bake reads every non-deleted page row
 * whatever its status, so a draft page still gets a URL. That asymmetry between
 * pages and collections is real, and it is the reason the missing URLs were all
 * collection entries and none of them were pages.
 */
async function draftCollectionRows(
  target: string,
): Promise<{ ok: true; ids: string[] } | { ok: false; reason: string }> {
  const tables = await runTool('connector_list_tables', { target })
  if (!tables.ok) return { ok: false, reason: `Could not list the tables: ${errorOf(tables.body)}` }
  const tableList = (() => {
    const b = tables.body as Record<string, unknown>
    const raw = b.tables ?? (b.result as Record<string, unknown> | undefined)?.tables ?? b
    return Array.isArray(raw) ? (raw as Record<string, unknown>[]) : []
  })()
  if (tableList.length === 0) return { ok: false, reason: 'The CMS reported no tables, so the rows could not be checked.' }

  const ids: string[] = []
  for (const table of tableList) {
    const slug = str(table.slug) || str(table.id)
    if (!slug || slug === 'pages') continue
    // Page every table: a limit that silently truncated would under-report the
    // drafts and put a partial site live again, which is the failure being fixed.
    for (let offset = 0; offset < 10_000; offset += 200) {
      const page = await runTool('connector_list_rows', { target, tableId: slug, limit: 200, offset })
      if (!page.ok) return { ok: false, reason: `Could not list rows in "${slug}": ${errorOf(page.body)}` }
      const b = page.body as Record<string, unknown>
      const raw = b.rows ?? (b.result as Record<string, unknown> | undefined)?.rows ?? []
      const rows = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : []
      for (const row of rows) {
        const status = str(row.status)
        if (status && status !== 'published') ids.push(str(row.id))
      }
      if (rows.length < 200) break
    }
  }
  return { ok: true, ids: ids.filter(Boolean) }
}

/**
 * Who actually signed, for the run's own history.
 *
 * It used to say "The owner granted the import GO" whatever happened, and on a
 * test property a validator-submitted GO is the ordinary case — so the record
 * named the wrong party for every acceptance run. A history that reports a role
 * it did not check is worse than one that says nothing.
 */
function grantedBy(go: unknown): string {
  const g = (go ?? {}) as Record<string, unknown>
  const who = typeof g.submittedBy === 'string' ? g.submittedBy
    : typeof g.grantedBy === 'string' ? g.grantedBy
      : typeof g.role === 'string' ? g.role
        : ''
  if (/validator/i.test(who)) return 'The validator'
  if (/owner/i.test(who)) return 'The owner'
  return who ? `${who}` : 'The approver'
}

/**
 * The deploy id to hand the relay's `verifying_live`.
 *
 * The relay requires one — it is what makes the record say WHAT was deployed
 * rather than merely that something was. The CMS does not always return an id of
 * its own, so this falls back to the content hash the run is bound to, which is
 * the most specific true thing available. It never invents a value.
 */
function deployIdOf(body: unknown, fallback: string): string {
  const b = (body ?? {}) as Record<string, unknown>
  const result = (b.result ?? b) as Record<string, unknown>
  for (const key of ['deployId', 'deploymentId', 'publishedSiteHash', 'siteHash', 'sha256']) {
    const v = result[key] ?? b[key]
    if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 200)
  }
  return fallback.slice(0, 200)
}

/**
 * Read the publish's own route check and say, in one sentence, why this push is
 * not finished — or null when it is.
 *
 * Deliberately driven off `missing` rather than off the `agrees` flag. `agrees`
 * compares the prediction with the bake, and both can be right about a site that
 * is wrong: a draft row is correctly predicted to bake nothing and correctly
 * bakes nothing. `missing` is the list of routes that were expected and are not
 * there, which is the question an operator is actually asking.
 *
 * A check that did not run is also not a pass (`checked: false`), for the same
 * reason the publish tool reports that state instead of staying silent: P2.
 */
function routeShortfall(routeCheck: unknown): string | null {
  if (routeCheck === null || routeCheck === undefined) {
    return 'The publish reported no route check at all, so there is no evidence the site it baked is complete. ' +
      'Not reporting this as done.'
  }
  const rc = routeCheck as Record<string, unknown>
  if (rc.checked === false) {
    return `The route check could not run (${String(rc.why ?? 'no reason given')}), so the site was published ` +
      'without evidence that its routes are all there. Not reporting this as done.'
  }
  const missing = Array.isArray(rc.missing) ? (rc.missing as unknown[]).map(String) : []
  if (missing.length > 0) {
    const shown = missing.slice(0, 8).join(', ')
    return `The site published, but ${missing.length} route(s) the bundle intended are not on it: ${shown}` +
      `${missing.length > 8 ? ', …' : ''}. A push that leaves URLs missing is not done.`
  }
  const unpublished = Number(rc.unpublishedRows ?? 0)
  if (unpublished > 0) {
    return `The site published, but ${unpublished} collection row(s) are still drafts, so their pages do not ` +
      'exist on the site. A push that leaves URLs missing is not done.'
  }
  return null
}

/**
 * A key that is the same for the same step of the same push, and different
 * across pushes.
 *
 * The relay replays a repeated Idempotency-Key rather than acting twice, so a
 * step whose answer was lost in transit resumes onto the ticket it already
 * opened instead of opening a second one — which is the failure that would put
 * two deploy-requests for one bundle in front of an owner.
 */
const stepKey = (state: PushState, step: string): string =>
  `push-${state.id}-${step}`.replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 128)

/**
 * Re-authenticate immediately before a write.
 *
 * The CMS requires a step-up for the two destructive operations — import and
 * publish — and the push loop did not do it, so a run that had cleared every
 * gate correctly, including an owner-signed GO, stopped at the import with
 * `401 step_up_required` and wrote nothing. The gate was working; the loop was
 * simply not carrying the credential the gate asks for.
 *
 * Done INSIDE the run, immediately before each write rather than once at the
 * start, because a step-up is deliberately short-lived: a push waits on two
 * human signatures, which take as long as they take, and an elevation taken
 * before the first wait would have expired long before the publish. That is also
 * why this is not a login — the session is already authenticated; this raises it
 * for one operation and the rotated cookie replaces the current one.
 *
 * The credential comes from server configuration, never from arguments, exactly
 * as it does in `connector_step_up`. No MFA code is passed: an account with MFA
 * enabled cannot be stepped up without a person, which would put one back inside
 * every push. Nothing provisions an account with MFA on — the column defaults to
 * false — so this stays at zero developer actions unless somebody turns it on
 * deliberately. If anyone ever does, this call fails and the run refuses with
 * the reason, rather than the push appearing to hang.
 */
async function elevate(state: PushState, what: string): Promise<string | null> {
  try {
    const target = resolveTarget(state.target)
    await stepUp(requireSession(target.name), target.secret)
    return null
  } catch (err) {
    return `Could not re-authenticate before the ${what}: ${err instanceof Error ? err.message : String(err)}`
  }
}

/** Run one of the Connector's own tools, so the loop passes every gate a person would. */
async function runTool(name: string, args: Record<string, unknown>): Promise<{ ok: boolean; body: unknown }> {
  const tool = [...IMPORT_TOOLS, ...CRUD_TOOLS, ...ADMIN_TOOLS].find((t) => t.name === name)
  if (!tool) return { ok: false, body: { error: `No such tool: ${name}` } }
  const result = await tool.handler(args)
  let body: unknown = null
  try {
    body = JSON.parse(result.content[0]?.text ?? 'null')
  } catch {
    body = result.content[0]?.text ?? null
  }
  return { ok: result.isError !== true, body }
}

const errorOf = (body: unknown): string => {
  const e = (body as { error?: unknown })?.error
  return typeof e === 'string' ? e : JSON.stringify(body)
}

/** Stop the run, recording why. A refused push is finished, not paused. */
function refuse(state: PushState, why: string): PushState {
  state.refusal = why
  note(state, 'refused', why)
  return savePush(state)
}

/**
 * Advance a push as far as it can go right now.
 *
 * Returns as soon as it reaches something only a person can supply. Calling it
 * again is always safe: every step is either idempotent or guarded by the
 * relay's own replay.
 */
export async function advancePush(state: PushState): Promise<PushState> {
  // A run can cross more than one boundary in a single call — a GO may already
  // be waiting when the import finishes — so this loops until it is genuinely
  // blocked rather than returning after one step and needing another poke.
  for (let guard = 0; guard < 8; guard++) {
    switch (state.step) {
      case 'preflight': {
        // The dry run, with `previewOnly`, reaches the pre-flight and writes
        // nothing. A bundle that would publish broken is refused HERE, before
        // an owner is asked to sign anything — asking somebody to approve a
        // bundle the machine already knows is broken is a round trip that
        // should never have happened.
        const preview = await runTool('connector_import_replace', {
          target: state.target,
          confirm: `REPLACE ${state.target}`,
          previewOnly: true,
          ...state.source,
        })
        if (!preview.ok) return refuse(state, `Pre-flight could not run: ${errorOf(preview.body)}`)

        const report = (preview.body as { preview?: Record<string, unknown> }).preview ?? {}
        const projection = report.publishProjection as { ok?: boolean; findings?: unknown[] } | undefined
        if (projection && projection.ok === false) {
          return refuse(
            state,
            `Pre-flight refused this bundle: ${JSON.stringify(projection.findings)}. Nobody was asked to approve it.`,
          )
        }
        const sha256 = str(report.sha256)
        if (!sha256) return refuse(state, 'The bundle has no sha256 to bind an approval to.')
        state.sha256 = sha256
        state.evidence = { preflight: projection ?? null, routes: report.publishProjection }

        const ticket = await openRelayDeployRequest(
          {
            title: `${state.title} — import`,
            action: 'import',
            target: resolveTarget(state.target).name,
            sha256,
            body:
              'Opened by the Connector as part of a self-service push. The pre-flight passed: ' +
              `${JSON.stringify((report.publishProjection as { styleRules?: unknown })?.styleRules ?? {})}.`,
          },
          stepKey(state, 'import-ticket'),
        )
        // Same rule as the GO reads: an unreachable relay is retried, a relay
        // that answered is believed. A missing token is configuration, not a
        // network blip, and is definitive.
        if (!ticket.ok && ticket.transient) return savePush(state)
        if (!ticket.ok) return refuse(state, `Could not open the import deploy-request: ${ticket.reason}`)
        state.importTicketId = ticket.value.id
        note(state, 'awaiting-import-go', `Import deploy-request ${ticket.value.id} is waiting for the owner's GO.`)
        savePush(state)
        break
      }

      case 'awaiting-import-go': {
        const go = await readRelayGo(state.importTicketId ?? '')
        // An unreachable relay leaves the run exactly where it is. Refusing on
        // a dropped connection would abandon a push whose owner may already
        // have signed, on no evidence at all.
        if (!go.ok && go.transient) return savePush(state)
        if (!go.ok) return refuse(state, `Could not read the import GO: ${go.reason}`)
        if (go.value === null) return savePush(state) // Still with the owner. Not an error.
        note(state, 'importing', `${grantedBy(go.value)} granted the import GO.`)
        savePush(state)

        // Spend the authorization on the relay BEFORE using it. This is the call
        // that consumes the GO — the relay's single-use check lives in the
        // `executing` transition — so skipping it left the signature replayable
        // and the ticket reading `go_granted` forever. A refusal here (already
        // consumed, expired) must stop the run: it means this GO is not ours to
        // spend.
        const importExec = await moveRelayTicket(state.importTicketId ?? '', 'executing', {
          idempotencyKey: stepKey(state, 'import-executing'),
        })
        if (!importExec.ok && importExec.transient) return savePush(state)
        if (!importExec.ok) return refuse(state, `The relay would not let the import GO be spent: ${importExec.reason}`)

        // Immediately before the write, not before the wait for the GO.
        const importElevation = await elevate(state, 'import')
        if (importElevation) return refuse(state, importElevation)

        const run = await runTool('connector_import_replace', {
          target: state.target,
          confirm: `REPLACE ${state.target}`,
          go: go.value,
          ...state.source,
        })
        if (!run.ok) {
          // Tell the relay it failed, so the ticket does not sit in `executing`
          // with a spent GO and no account of what happened.
          await moveRelayTicket(state.importTicketId ?? '', 'failed', {
            note: `The import refused or failed: ${errorOf(run.body)}`.slice(0, 200),
            idempotencyKey: stepKey(state, 'import-failed'),
          })
          return refuse(state, `The import refused or failed: ${errorOf(run.body)}`)
        }
        await moveRelayTicket(state.importTicketId ?? '', 'verifying_live', {
          deployId: deployIdOf(run.body, state.sha256 ?? 'import'),
          idempotencyKey: stepKey(state, 'import-verifying'),
        })
        note(state, 'inspect', 'The bundle imported under the signed GO.')
        savePush(state)
        break
      }

      case 'inspect': {
        // "Rows can be inspected between the two gates" (AC-B7.5) is a
        // requirement, not a courtesy: the second approval is supposed to be
        // informed by what the first one actually landed.
        const digest = await runTool('connector_site_digest', { target: state.target })
        if (!digest.ok) return refuse(state, `Could not read the site digest: ${errorOf(digest.body)}`)
        const d = digest.body as { sha256?: string; contentDigest?: string }
        if (!d.contentDigest) return refuse(state, 'The CMS reported no draft digest to bind a publish approval to.')
        state.evidence = { ...(state.evidence ?? {}), imported: d }

        // The rows the import landed as drafts, read from the TARGET rather than
        // inferred from the bundle: after a replace the CMS is the only thing that
        // knows which ids exist and what status they carry.
        const drafts = await draftCollectionRows(state.target)
        if (!drafts.ok) return refuse(state, drafts.reason)

        if (drafts.ids.length > 0) {
          const rowsDigest = await runTool('connector_rows_digest', { target: state.target, rowIds: drafts.ids })
          if (!rowsDigest.ok) {
            return refuse(state, `Could not take the rows digest to bind a row approval to: ${errorOf(rowsDigest.body)}`)
          }
          const rd = rowsDigest.body as { sha256?: string; digest?: string }
          const rowsSha = str(rd.sha256) || str(rd.digest)
          if (!rowsSha) return refuse(state, 'The CMS reported no rows digest to bind a row approval to.')
          state.rows = { ids: drafts.ids, digest: rowsSha }

          const rowsTicket = await openRelayDeployRequest(
            {
              title: `${state.title} — publish ${drafts.ids.length} collection row(s)`,
              action: 'publish-row',
              target: resolveTarget(state.target).name,
              sha256: rowsSha,
              body:
                `Opened by the Connector after the import landed. ${drafts.ids.length} collection row(s) ` +
                'arrived as drafts, and a site publish bakes pages but not rows — so without this the ' +
                'site would go live with those entry URLs serving the homepage. One approval covers the ' +
                'whole set, bound to the digest of exactly these rows.',
            },
            stepKey(state, 'rows-ticket'),
          )
          if (!rowsTicket.ok && rowsTicket.transient) return savePush(state)
          if (!rowsTicket.ok) return refuse(state, `Could not open the rows deploy-request: ${rowsTicket.reason}`)
          state.rowsTicketId = rowsTicket.value.id
          note(
            state,
            'awaiting-rows-go',
            `Rows deploy-request ${rowsTicket.value.id} is waiting for a GO on ${drafts.ids.length} row(s).`,
          )
          savePush(state)
          break
        }

        const ticket = await openRelayDeployRequest(
          {
            title: `${state.title} — publish`,
            action: 'publish',
            target: resolveTarget(state.target).name,
            sha256: d.sha256 ?? state.sha256 ?? '',
            contentDigest: d.contentDigest,
            body:
              'Opened by the Connector after the import landed. The draft is inspectable now; this ' +
              'approval covers publishing it, and binds to the draft as it stands.',
          },
          stepKey(state, 'publish-ticket'),
        )
        if (!ticket.ok && ticket.transient) return savePush(state) // See the import case.
        if (!ticket.ok) return refuse(state, `Could not open the publish deploy-request: ${ticket.reason}`)
        state.publishTicketId = ticket.value.id
        note(state, 'awaiting-publish-go', `Publish deploy-request ${ticket.value.id} is waiting for the owner's GO.`)
        savePush(state)
        break
      }

      case 'awaiting-rows-go': {
        const go = await readRelayGo(state.rowsTicketId ?? '')
        if (!go.ok && go.transient) return savePush(state) // See the import case.
        if (!go.ok) return refuse(state, `Could not read the rows GO: ${go.reason}`)
        if (go.value === null) return savePush(state) // Still with the approver. Not an error.
        note(state, 'publishing-rows', `${grantedBy(go.value)} granted the rows GO.`)
        savePush(state)

        const rowsExec = await moveRelayTicket(state.rowsTicketId ?? '', 'executing', {
          idempotencyKey: stepKey(state, 'rows-executing'),
        })
        if (!rowsExec.ok && rowsExec.transient) return savePush(state)
        if (!rowsExec.ok) return refuse(state, `The relay would not let the rows GO be spent: ${rowsExec.reason}`)

        const rowsElevation = await elevate(state, 'publish rows')
        if (rowsElevation) return refuse(state, rowsElevation)

        const run = await runTool('connector_publish_rows', {
          target: state.target,
          rowIds: state.rows?.ids ?? [],
          go: go.value,
        })
        if (!run.ok) {
          await moveRelayTicket(state.rowsTicketId ?? '', 'failed', {
            note: `The row publish refused or failed: ${errorOf(run.body)}`.slice(0, 200),
            idempotencyKey: stepKey(state, 'rows-failed'),
          })
          return refuse(state, `The row publish refused or failed: ${errorOf(run.body)}`)
        }

        // A partial row publish is reported per row on purpose, so a failure is
        // visible rather than averaged away. Any failure stops the run BEFORE the
        // site publish — publishing the site now would bake an incomplete set and
        // report success, which is the exact behaviour this whole change exists to
        // remove.
        const rowsBody = (run.body as { result?: Record<string, unknown> }).result ?? (run.body as Record<string, unknown>)
        const failed = Array.isArray(rowsBody.failed) ? (rowsBody.failed as unknown[]) : []
        if (failed.length > 0) {
          await moveRelayTicket(state.rowsTicketId ?? '', 'failed', {
            note: `${failed.length} row(s) did not publish.`,
            idempotencyKey: stepKey(state, 'rows-partial'),
          })
          return refuse(
            state,
            `${failed.length} of ${state.rows?.ids.length ?? 0} row(s) did not publish: ` +
              `${JSON.stringify(failed).slice(0, 400)}. The site was NOT published — it would have gone ` +
              'live with those entry URLs missing.',
          )
        }
        await moveRelayTicket(state.rowsTicketId ?? '', 'verifying_live', {
          deployId: state.rows?.digest ?? 'publish-row',
          idempotencyKey: stepKey(state, 'rows-verifying'),
        })
        state.evidence = { ...(state.evidence ?? {}), rowsPublished: rowsBody }
        note(state, 'publishing-rows', `${state.rows?.ids.length ?? 0} collection row(s) published.`)
        savePush(state)
        break
      }

      case 'publishing-rows': {
        // The rows are live; the site publish is what bakes their pages. The
        // publish approval is opened here rather than at `inspect`, so it binds to
        // the draft digest AS IT IS NOW — after the rows changed status. Binding
        // it before would name a digest the publish then refuses (412).
        const digest = await runTool('connector_site_digest', { target: state.target })
        if (!digest.ok) return refuse(state, `Could not read the site digest: ${errorOf(digest.body)}`)
        const d = digest.body as { sha256?: string; contentDigest?: string }
        if (!d.contentDigest) return refuse(state, 'The CMS reported no draft digest to bind a publish approval to.')
        state.evidence = { ...(state.evidence ?? {}), imported: d }

        const ticket = await openRelayDeployRequest(
          {
            title: `${state.title} — publish`,
            action: 'publish',
            target: resolveTarget(state.target).name,
            sha256: d.sha256 ?? state.sha256 ?? '',
            contentDigest: d.contentDigest,
            body:
              'Opened by the Connector after the collection rows were published. This approval covers ' +
              'publishing the site, and binds to the draft as it stands now.',
          },
          stepKey(state, 'publish-ticket'),
        )
        if (!ticket.ok && ticket.transient) return savePush(state)
        if (!ticket.ok) return refuse(state, `Could not open the publish deploy-request: ${ticket.reason}`)
        state.publishTicketId = ticket.value.id
        note(state, 'awaiting-publish-go', `Publish deploy-request ${ticket.value.id} is waiting for the owner's GO.`)
        savePush(state)
        break
      }

      case 'awaiting-publish-go': {
        const go = await readRelayGo(state.publishTicketId ?? '')
        if (!go.ok && go.transient) return savePush(state) // See the import case.
        if (!go.ok) return refuse(state, `Could not read the publish GO: ${go.reason}`)
        if (go.value === null) return savePush(state)
        note(state, 'publishing', `${grantedBy(go.value)} granted the publish GO.`)
        savePush(state)

        const publishExec = await moveRelayTicket(state.publishTicketId ?? '', 'executing', {
          idempotencyKey: stepKey(state, 'publish-executing'),
        })
        if (!publishExec.ok && publishExec.transient) return savePush(state)
        if (!publishExec.ok) return refuse(state, `The relay would not let the publish GO be spent: ${publishExec.reason}`)

        const publishElevation = await elevate(state, 'publish')
        if (publishElevation) return refuse(state, publishElevation)

        const run = await runTool('connector_publish_site', { target: state.target, go: go.value })
        if (!run.ok) {
          await moveRelayTicket(state.publishTicketId ?? '', 'failed', {
            note: `The publish refused or failed: ${errorOf(run.body)}`.slice(0, 200),
            idempotencyKey: stepKey(state, 'publish-failed'),
          })
          return refuse(state, `The publish refused or failed: ${errorOf(run.body)}`)
        }
        const body = run.body as { routeCheck?: unknown; result?: unknown }
        state.evidence = { ...(state.evidence ?? {}), published: body.result ?? null, routeCheck: body.routeCheck ?? null }

        // A PARTIAL SITE IS NOT A DONE PUSH.
        //
        // The first full acceptance run reached `done` while 8 of 18 URLs served
        // the homepage, and the route check agreed with itself because it
        // compared what the bake WOULD do against what it DID. Both numbers were
        // right and the site was wrong. So the run now asks the separate
        // question — is any route the bundle intended still missing — and refuses
        // to call itself done when the answer is yes.
        const shortfall = routeShortfall(body.routeCheck)
        if (shortfall) {
          await moveRelayTicket(state.publishTicketId ?? '', 'failed', {
            note: shortfall.slice(0, 200),
            idempotencyKey: stepKey(state, 'publish-partial'),
          })
          return refuse(state, shortfall)
        }

        await moveRelayTicket(state.publishTicketId ?? '', 'verifying_live', {
          deployId: deployIdOf(run.body, state.sha256 ?? 'publish'),
          idempotencyKey: stepKey(state, 'publish-verifying'),
        })
        note(state, 'done', 'The site is published.')
        savePush(state)
        // The queue carries what the machine did, so the validator reads the
        // outcome on the ticket rather than being told it.
        if (state.publishTicketId) {
          await postRelayMessage(
            state.publishTicketId,
            `Published. Route check: ${JSON.stringify(body.routeCheck ?? 'not reported')}.`,
            stepKey(state, 'publish-note'),
          )
        }
        break
      }

      default:
        return savePush(state)
    }
    if (state.step === 'done' || state.step === 'refused') return savePush(state)
  }
  return savePush(state)
}

/** What a caller is told after each advance: where the run is, and whose move it is. */
function report(state: PushState): Record<string, unknown> {
  const waitingOn =
    state.step === 'awaiting-import-go'
    || state.step === 'awaiting-rows-go'
    || state.step === 'awaiting-publish-go'
      ? 'owner'
      : state.step === 'done' || state.step === 'refused'
        ? 'nobody'
        : 'connector'
  return {
    pushId: state.id,
    target: state.target,
    step: state.step,
    waitingOn,
    ...(state.importTicketId ? { importTicket: state.importTicketId } : {}),
    ...(state.rowsTicketId ? { rowsTicket: state.rowsTicketId } : {}),
    ...(state.rows ? { rows: { count: state.rows.ids.length, digest: state.rows.digest } } : {}),
    ...(state.publishTicketId ? { publishTicket: state.publishTicketId } : {}),
    ...(state.refusal ? { refusal: state.refusal } : {}),
    ...(state.evidence ? { evidence: state.evidence } : {}),
    // The count the milestone is measured in. Everything this loop does is a
    // step a developer used to take by hand.
    developerActions: 0,
    history: state.history,
  }
}

export const PUSH_TOOLS: ConnectorTool[] = [
  {
    name: 'connector_push_site',
    description:
      'Run a full push end to end: pre-flight, import under the owner-signed GO, inspect, then ' +
      'publish under a second GO. WRITES. Start one by naming a target and a bundle (relaySha256, ' +
      'uploadId or path); continue one by passing its pushId. Each call advances as far as it can ' +
      'and returns immediately — it never waits on a person. When `waitingOn` is "owner" the run ' +
      'is parked until that GO is granted; call again with the same pushId to continue. A bundle ' +
      'the pre-flight refuses stops the run BEFORE anybody is asked to approve it. This drives the ' +
      'ordinary import and publish tools, so it passes exactly the same gates a person would.',
    inputSchema: {
      type: 'object',
      properties: {
        pushId: { type: 'string', description: 'Continue an existing push. Omit to start one.' },
        target: { type: 'string', description: 'Which configured CMS. Required when starting.' },
        title: { type: 'string', description: 'What the deploy-requests are called in the queue.' },
        relaySha256: { type: 'string', description: 'A bundle artefact on the relay — the route for a real site.' },
        uploadId: { type: 'string', description: 'A bundle already POSTed to /imports.' },
        path: { type: 'string', description: 'Or a site-bundle .zip on the SERVER filesystem.' },
      },
      additionalProperties: false,
    },
    handler: async (a) => {
      try {
        const id = str(a.pushId).trim()
        if (id) {
          const existing = loadPush(id)
          if (!existing) return fail(`No push with id ${id}.`)
          return ok(report(await advancePush(existing)))
        }

        const target = str(a.target)
        const source = {
          ...(str(a.relaySha256) ? { relaySha256: str(a.relaySha256) } : {}),
          ...(str(a.uploadId) ? { uploadId: str(a.uploadId) } : {}),
          ...(str(a.path) ? { path: str(a.path) } : {}),
        }
        if (Object.keys(source).length !== 1) {
          return fail('Name the bundle with exactly one of relaySha256, uploadId or path.')
        }
        const now = new Date().toISOString()
        const state: PushState = {
          id: createHash('sha256').update(`${target}|${JSON.stringify(source)}|${now}`).digest('hex').slice(0, 12),
          target,
          title: str(a.title) || `Push to ${target || 'the default target'}`,
          step: 'preflight',
          source,
          startedAt: now,
          updatedAt: now,
          history: [{ at: now, step: 'preflight', note: 'Push opened.' }],
        }
        savePush(state)
        return ok(report(await advancePush(state)))
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err))
      }
    },
  },

  {
    name: 'connector_push_status',
    description:
      'Where a push has got to, and whose move it is. Read-only. With no pushId it lists every ' +
      'push this Connector has on file, newest first.',
    inputSchema: {
      type: 'object',
      properties: { pushId: { type: 'string' } },
      additionalProperties: false,
    },
    handler: async (a) => {
      try {
        const id = str(a.pushId).trim()
        if (id) {
          const state = loadPush(id)
          return state ? ok(report(state)) : fail(`No push with id ${id}.`)
        }
        const pushes = readdirSync(pushDir())
          .filter((f) => f.endsWith('.json'))
          .map((f) => loadPush(f.replace(/\.json$/, '')))
          .filter((s): s is PushState => s !== null)
          .sort((x, y) => y.startedAt.localeCompare(x.startedAt))
          .map((s) => ({
            pushId: s.id,
            target: s.target,
            step: s.step,
            startedAt: s.startedAt,
            updatedAt: s.updatedAt,
            ...(s.refusal ? { refusal: s.refusal } : {}),
          }))
        return ok({ pushes })
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err))
      }
    },
  },
]

/**
 * Keep parked pushes moving without anybody poking them (R13).
 *
 * A push waits for two owner signatures, and the wait is the one part of the
 * loop nobody can shorten. What R13 does rule out is a developer sitting on the
 * other end of it: if resuming needs a person to run something once the owner
 * signs, the round-trip count is not zero, it is two.
 *
 * WHY POLLING AND NOT THE RELAY'S WEBHOOK. The relay is a Cloudflare Worker and
 * the Connector listens on loopback behind the operator's gateway, reachable
 * over a tailnet and from nowhere else. A webhook would need the Worker to reach
 * into that network, so the event channel that looks more elegant is the one
 * that cannot be delivered. Asking the relay is cheap — one GET per parked push,
 * and only while a push is actually parked — and it needs nothing opened up.
 *
 * Every advance is idempotent and the relay replays a repeated key, so a sweep
 * that overlaps a manual call cannot double-import or open a second ticket.
 */

/** Rare enough to cost nothing, often enough that an owner's signature is acted on while they are still there. */
const SWEEP_INTERVAL_MS = 30_000

/**
 * Steps a sweep can move on.
 *
 * The two waits are the obvious ones. `preflight` is here because a run whose
 * very first relay call failed for a transient reason stays there — without it
 * that run would sit untouched forever, which is the same stall by a different
 * route. A pre-flight writes nothing, so re-running one costs nothing but time.
 */
const PARKED: PushStep[] = [
  'preflight',
  'awaiting-import-go',
  // The rows gate parks on an approver exactly like the other two, so it has to
  // be swept like the other two. Leaving it out would have made every push that
  // reached it wait forever unless somebody called the tool again by hand —
  // which is the developer round trip this whole loop exists to remove.
  'awaiting-rows-go',
  'awaiting-publish-go',
]

let sweeping = false

/** Advance every parked push once. Exported so a test can run one sweep deterministically. */
export async function sweepParkedPushes(): Promise<{ swept: number; advanced: string[] }> {
  const advanced: string[] = []
  let swept = 0
  let ids: string[] = []
  try {
    ids = readdirSync(pushDir())
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''))
  } catch {
    return { swept: 0, advanced: [] }
  }

  for (const id of ids) {
    const state = loadPush(id)
    if (!state || !PARKED.includes(state.step)) continue
    swept++
    const before = state.step
    try {
      const after = await advancePush(state)
      if (after.step !== before) advanced.push(`${id}: ${before} -> ${after.step}`)
    } catch (err) {
      // A sweep is best-effort. One unreachable relay must not stop the others,
      // and must not mark a run refused — the push stays exactly where it was
      // and the next sweep tries again.
      console.warn(`[push] sweep failed for ${id}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return { swept, advanced }
}

/**
 * Run the sweep on a timer for as long as the server is up.
 *
 * `unref` so it never holds the process open by itself: the MCP server decides
 * the lifetime, and a sweeper that kept a shut-down process alive would be its
 * own small bug.
 */
export function startPushSweeper(intervalMs = SWEEP_INTERVAL_MS): { stop: () => void } {
  const timer = setInterval(() => {
    if (sweeping) return // A slow sweep must not overlap itself.
    sweeping = true
    void sweepParkedPushes()
      .then(({ advanced }) => {
        for (const line of advanced) console.log(`[push] ${line}`)
      })
      .finally(() => {
        sweeping = false
      })
  }, intervalMs)
  timer.unref?.()
  return { stop: () => clearInterval(timer) }
}
