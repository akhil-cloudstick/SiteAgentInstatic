/**
 * D1 (SQLite) store and R2 blobs — production.
 *
 * Append-only is enforced twice: here, by exposing no update or delete for
 * messages, transitions, artefacts or GOs, and in the schema, by triggers that
 * abort any such statement (`migrations/0001_init.sql`). The second layer is
 * for whoever holds the database console — which, with the relay in the
 * builder's account, is the builder. The validator's git mirror of the export
 * is what would catch that layer being dropped.
 */

import { goLines, ticketLine } from './export'
import type { GoAction } from './go'
import type { Blobs, Store } from './store'
import type {
  ArtefactMeta,
  Evidence,
  ExportLine,
  FlagRecord,
  GoRecord,
  IdempotencyRecord,
  Message,
  MessageKind,
  Role,
  Ticket,
  TicketType,
  TransitionActor,
  TransitionRecord,
} from './types'
import type { D1Database, R2Bucket } from './worker-types'

interface TicketRow {
  id: string
  seq: number
  type: string
  title: string
  body: string
  state: string
  created_by: string
  created_at: string
  updated_at: string
  state_since: string
  artefacts: string
  action: string | null
  target: string | null
  sha256: string | null
  content_digest: string | null
  deploy_id: string | null
  validator_stalled: number
  last_validator_at: string | null
  adjudicated: number
}

interface MessageRow {
  id: string
  seq: number
  ticket_id: string
  kind: string
  author: string
  body: string
  evidence: string | null
  reply_to: string | null
  artefacts: string
  created_at: string
}

interface TransitionRow {
  seq: number
  ticket_id: string
  from_state: string
  to_state: string
  by_role: string
  at: string
  evidence_message_id: string | null
  deploy_id: string | null
}

interface ArtefactRow {
  sha256: string
  seq: number
  bytes: number
  uploaded_by: string
  created_at: string
}

interface GoRow {
  ticket_id: string
  seq: number
  nonce: string
  payload: string
  owner_key_fingerprint: string
  granted_at: string
  consumed_at: string | null
  consumed_seq: number | null
}

interface FlagRow {
  seq: number
  ticket_id: string
  validator_stalled: number
  at: string
}

interface IdempotencyRow {
  subject: string
  key: string
  request_sha256: string
  status: number
  body: string
  created_at: string
}

const toTicket = (r: TicketRow): Ticket => ({
  id: r.id,
  seq: r.seq,
  type: r.type as TicketType,
  title: r.title,
  body: r.body,
  state: r.state,
  createdBy: r.created_by as Role,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  stateSince: r.state_since,
  artefacts: JSON.parse(r.artefacts) as string[],
  action: r.action as GoAction | null,
  target: r.target,
  sha256: r.sha256,
  contentDigest: r.content_digest,
  deployId: r.deploy_id,
  validatorStalled: r.validator_stalled === 1,
  lastValidatorAt: r.last_validator_at,
  adjudicated: r.adjudicated === 1,
})

const toMessage = (r: MessageRow): Message => ({
  id: r.id,
  seq: r.seq,
  ticketId: r.ticket_id,
  kind: r.kind as MessageKind,
  author: r.author as Role,
  body: r.body,
  evidence: r.evidence ? (JSON.parse(r.evidence) as Evidence) : null,
  replyTo: r.reply_to,
  artefacts: JSON.parse(r.artefacts) as string[],
  createdAt: r.created_at,
})

const toTransition = (r: TransitionRow): TransitionRecord => ({
  seq: r.seq,
  ticketId: r.ticket_id,
  from: r.from_state,
  to: r.to_state,
  by: r.by_role as TransitionActor,
  at: r.at,
  evidenceMessageId: r.evidence_message_id,
  deployId: r.deploy_id,
})

const toArtefact = (r: ArtefactRow): ArtefactMeta => ({
  sha256: r.sha256,
  seq: r.seq,
  bytes: r.bytes,
  uploadedBy: r.uploaded_by as Role,
  createdAt: r.created_at,
})

const toGo = (r: GoRow): GoRecord => ({
  ticketId: r.ticket_id,
  seq: r.seq,
  go: JSON.parse(r.payload) as GoRecord['go'],
  ownerKeyFingerprint: r.owner_key_fingerprint,
  grantedAt: r.granted_at,
  consumedAt: r.consumed_at,
  consumedSeq: r.consumed_seq,
})

const toFlag = (r: FlagRow): FlagRecord => ({
  seq: r.seq,
  ticketId: r.ticket_id,
  validatorStalled: r.validator_stalled === 1,
  at: r.at,
})

export class D1Store implements Store {
  constructor(private readonly db: D1Database) {}

  async nextSeq(): Promise<number> {
    const row = await this.db
      .prepare(`UPDATE seq SET value = value + 1 WHERE name = 'global' RETURNING value`)
      .first<{ value: number }>()
    if (!row) throw new Error('The seq counter row is missing — apply the migrations.')
    return row.value
  }

  async insertTicket(t: Ticket): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO tickets (id, seq, type, title, body, state, created_by, created_at, updated_at, state_since,
           artefacts, action, target, sha256, content_digest, deploy_id, validator_stalled, last_validator_at,
           adjudicated)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        t.id,
        t.seq,
        t.type,
        t.title,
        t.body,
        t.state,
        t.createdBy,
        t.createdAt,
        t.updatedAt,
        t.stateSince,
        JSON.stringify(t.artefacts),
        t.action,
        t.target,
        t.sha256,
        t.contentDigest,
        t.deployId,
        t.validatorStalled ? 1 : 0,
        t.lastValidatorAt,
        t.adjudicated ? 1 : 0,
      )
      .run()
  }

  async getTicket(id: string): Promise<Ticket | null> {
    const row = await this.db.prepare('SELECT * FROM tickets WHERE id = ?').bind(id).first<TicketRow>()
    return row ? toTicket(row) : null
  }

  async listTickets(): Promise<Ticket[]> {
    const { results } = await this.db.prepare('SELECT * FROM tickets ORDER BY seq DESC').all<TicketRow>()
    return results.map(toTicket)
  }

  async applyTransition(tr: TransitionRecord, patch: { deployId?: string; adjudicated?: boolean }): Promise<boolean> {
    // One batch = one transaction. Both statements are conditional on the
    // ticket still being in `from`, so a second caller racing the same move
    // inserts nothing and updates nothing.
    const insert = this.db
      .prepare(
        `INSERT INTO transitions (seq, ticket_id, from_state, to_state, by_role, at, evidence_message_id, deploy_id)
         SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM tickets WHERE id = ? AND state = ?)`,
      )
      .bind(tr.seq, tr.ticketId, tr.from, tr.to, tr.by, tr.at, tr.evidenceMessageId, tr.deployId, tr.ticketId, tr.from)
    const update = this.db
      .prepare(
        `UPDATE tickets SET state = ?, updated_at = ?, state_since = ?,
           deploy_id = COALESCE(?, deploy_id), adjudicated = MAX(adjudicated, ?)
         WHERE id = ? AND state = ?`,
      )
      .bind(tr.to, tr.at, tr.at, patch.deployId ?? null, patch.adjudicated ? 1 : 0, tr.ticketId, tr.from)
    const results = await this.db.batch([insert, update])
    return results[1]?.meta.changes === 1
  }

  async listTransitions(ticketId: string): Promise<TransitionRecord[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM transitions WHERE ticket_id = ? ORDER BY seq')
      .bind(ticketId)
      .all<TransitionRow>()
    return results.map(toTransition)
  }

  async recordValidatorActivity(ticketId: string, at: string, flag: FlagRecord | null): Promise<void> {
    const stamp = this.db.prepare('UPDATE tickets SET last_validator_at = ? WHERE id = ?').bind(at, ticketId)
    if (!flag) {
      await stamp.run()
      return
    }
    await this.db.batch([stamp, ...this.flagStatements(flag)])
  }

  async setStalled(flag: FlagRecord): Promise<void> {
    await this.db.batch(this.flagStatements(flag))
  }

  private flagStatements(flag: FlagRecord) {
    return [
      this.db
        .prepare('UPDATE tickets SET validator_stalled = ? WHERE id = ?')
        .bind(flag.validatorStalled ? 1 : 0, flag.ticketId),
      this.db
        .prepare('INSERT INTO flags (seq, ticket_id, validator_stalled, at) VALUES (?, ?, ?, ?)')
        .bind(flag.seq, flag.ticketId, flag.validatorStalled ? 1 : 0, flag.at),
    ]
  }

  async insertMessage(m: Message): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO messages (id, seq, ticket_id, kind, author, body, evidence, reply_to, artefacts, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        m.id,
        m.seq,
        m.ticketId,
        m.kind,
        m.author,
        m.body,
        m.evidence ? JSON.stringify(m.evidence) : null,
        m.replyTo,
        JSON.stringify(m.artefacts),
        m.createdAt,
      )
      .run()
  }

  async getMessage(id: string): Promise<Message | null> {
    const row = await this.db.prepare('SELECT * FROM messages WHERE id = ?').bind(id).first<MessageRow>()
    return row ? toMessage(row) : null
  }

  async listMessages(ticketId: string): Promise<Message[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM messages WHERE ticket_id = ? ORDER BY seq')
      .bind(ticketId)
      .all<MessageRow>()
    return results.map(toMessage)
  }

  async getArtefact(sha256: string): Promise<ArtefactMeta | null> {
    const row = await this.db.prepare('SELECT * FROM artefacts WHERE sha256 = ?').bind(sha256).first<ArtefactRow>()
    return row ? toArtefact(row) : null
  }

  async insertArtefact(a: ArtefactMeta): Promise<void> {
    await this.db
      .prepare('INSERT OR IGNORE INTO artefacts (sha256, seq, bytes, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(a.sha256, a.seq, a.bytes, a.uploadedBy, a.createdAt)
      .run()
  }

  async getGo(ticketId: string): Promise<GoRecord | null> {
    const row = await this.db.prepare('SELECT * FROM gos WHERE ticket_id = ?').bind(ticketId).first<GoRow>()
    return row ? toGo(row) : null
  }

  async nonceUsed(nonce: string): Promise<boolean> {
    return (await this.db.prepare('SELECT 1 AS used FROM gos WHERE nonce = ?').bind(nonce).first()) !== null
  }

  async insertGo(g: GoRecord): Promise<boolean> {
    const result = await this.db
      .prepare(
        `INSERT OR IGNORE INTO gos (ticket_id, seq, nonce, payload, owner_key_fingerprint, granted_at, consumed_at, consumed_seq)
         VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)`,
      )
      .bind(g.ticketId, g.seq, g.go.nonce, JSON.stringify(g.go), g.ownerKeyFingerprint, g.grantedAt)
      .run()
    return result.meta.changes === 1
  }

  async consumeGo(ticketId: string, at: string, seq: number): Promise<boolean> {
    const result = await this.db
      .prepare('UPDATE gos SET consumed_at = ?, consumed_seq = ? WHERE ticket_id = ? AND consumed_at IS NULL')
      .bind(at, seq, ticketId)
      .run()
    return result.meta.changes === 1
  }

  async getIdempotency(subject: string, key: string): Promise<IdempotencyRecord | null> {
    const row = await this.db
      .prepare('SELECT * FROM idempotency WHERE subject = ? AND key = ?')
      .bind(subject, key)
      .first<IdempotencyRow>()
    return row
      ? {
          subject: row.subject,
          key: row.key,
          requestSha256: row.request_sha256,
          status: row.status,
          body: row.body,
          createdAt: row.created_at,
        }
      : null
  }

  async putIdempotency(r: IdempotencyRecord): Promise<void> {
    await this.db
      .prepare(
        `INSERT OR IGNORE INTO idempotency (subject, key, request_sha256, status, body, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(r.subject, r.key, r.requestSha256, r.status, r.body, r.createdAt)
      .run()
  }

  async exportLines(): Promise<ExportLine[]> {
    const [tickets, messages, transitions, artefacts, gos, flags] = await Promise.all([
      this.db.prepare('SELECT * FROM tickets').all<TicketRow>(),
      this.db.prepare('SELECT * FROM messages').all<MessageRow>(),
      this.db.prepare('SELECT * FROM transitions').all<TransitionRow>(),
      this.db.prepare('SELECT * FROM artefacts').all<ArtefactRow>(),
      this.db.prepare('SELECT * FROM gos').all<GoRow>(),
      this.db.prepare('SELECT * FROM flags').all<FlagRow>(),
    ])
    const lines: ExportLine[] = [
      ...tickets.results.map((r) => ticketLine(toTicket(r))),
      ...messages.results.map((r): ExportLine => ({ type: 'message', ...toMessage(r) })),
      ...transitions.results.map((r): ExportLine => ({ type: 'transition', ...toTransition(r) })),
      ...artefacts.results.map((r): ExportLine => ({ type: 'artefact', ...toArtefact(r) })),
      ...gos.results.flatMap((r) => goLines(toGo(r))),
      ...flags.results.map((r): ExportLine => ({ type: 'flag', ...toFlag(r) })),
    ]
    return lines.sort((a, b) => a.seq - b.seq)
  }
}

export class R2Blobs implements Blobs {
  constructor(private readonly bucket: R2Bucket) {}

  async put(sha256: string, bytes: Uint8Array): Promise<void> {
    // R2 verifies the hash server-side and rejects the write on a mismatch.
    await this.bucket.put(`sha256/${sha256}`, bytes, { sha256, customMetadata: { sha256 } })
  }

  async get(sha256: string): Promise<Uint8Array<ArrayBuffer> | null> {
    const object = await this.bucket.get(`sha256/${sha256}`)
    return object ? new Uint8Array(await object.arrayBuffer()) : null
  }
}
