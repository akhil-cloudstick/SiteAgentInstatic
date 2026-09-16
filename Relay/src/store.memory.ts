/**
 * In-memory store for tests. Mirrors `store.d1.ts` semantics, including the
 * atomic compare-and-set moves, and clones on the way in and out so a handler
 * holding a record cannot mutate stored state behind the store's back.
 */

import { goLines, ticketLine } from './export'
import type { Blobs, Store } from './store'
import type {
  ArtefactMeta,
  ExportLine,
  FlagRecord,
  GoRecord,
  IdempotencyRecord,
  Message,
  Ticket,
  TransitionRecord,
} from './types'

const clone = <T>(value: T): T => structuredClone(value)

export class MemoryStore implements Store {
  private seq = 0
  private readonly tickets = new Map<string, Ticket>()
  private readonly messages: Message[] = []
  private readonly transitions: TransitionRecord[] = []
  private readonly artefacts = new Map<string, ArtefactMeta>()
  private readonly gos = new Map<string, GoRecord>()
  private readonly flags: FlagRecord[] = []
  private readonly idempotency = new Map<string, IdempotencyRecord>()

  async nextSeq(): Promise<number> {
    return ++this.seq
  }

  async insertTicket(ticket: Ticket): Promise<void> {
    if (this.tickets.has(ticket.id)) throw new Error(`duplicate ticket ${ticket.id}`)
    this.tickets.set(ticket.id, clone(ticket))
  }

  async getTicket(id: string): Promise<Ticket | null> {
    const t = this.tickets.get(id)
    return t ? clone(t) : null
  }

  async listTickets(): Promise<Ticket[]> {
    return [...this.tickets.values()].sort((a, b) => b.seq - a.seq).map(clone)
  }

  async applyTransition(tr: TransitionRecord, patch: { deployId?: string; adjudicated?: boolean }): Promise<boolean> {
    const t = this.tickets.get(tr.ticketId)
    if (!t || t.state !== tr.from) return false
    t.state = tr.to
    t.updatedAt = tr.at
    t.stateSince = tr.at
    if (patch.deployId) t.deployId = patch.deployId
    if (patch.adjudicated) t.adjudicated = true
    this.transitions.push(clone(tr))
    return true
  }

  async listTransitions(ticketId: string): Promise<TransitionRecord[]> {
    return this.transitions.filter((tr) => tr.ticketId === ticketId).map(clone)
  }

  async recordValidatorActivity(ticketId: string, at: string, flag: FlagRecord | null): Promise<void> {
    const t = this.tickets.get(ticketId)
    if (!t) return
    t.lastValidatorAt = at
    if (flag) {
      t.validatorStalled = flag.validatorStalled
      this.flags.push(clone(flag))
    }
  }

  async setStalled(flag: FlagRecord): Promise<void> {
    const t = this.tickets.get(flag.ticketId)
    if (!t) return
    t.validatorStalled = flag.validatorStalled
    this.flags.push(clone(flag))
  }

  async insertMessage(message: Message): Promise<void> {
    this.messages.push(clone(message))
  }

  async getMessage(id: string): Promise<Message | null> {
    const m = this.messages.find((x) => x.id === id)
    return m ? clone(m) : null
  }

  async listMessages(ticketId: string): Promise<Message[]> {
    return this.messages.filter((m) => m.ticketId === ticketId).map(clone)
  }

  async getArtefact(sha256: string): Promise<ArtefactMeta | null> {
    const a = this.artefacts.get(sha256)
    return a ? clone(a) : null
  }

  async insertArtefact(meta: ArtefactMeta): Promise<void> {
    if (!this.artefacts.has(meta.sha256)) this.artefacts.set(meta.sha256, clone(meta))
  }

  async getGo(ticketId: string): Promise<GoRecord | null> {
    const g = this.gos.get(ticketId)
    return g ? clone(g) : null
  }

  async nonceUsed(nonce: string): Promise<boolean> {
    return [...this.gos.values()].some((g) => g.go.nonce === nonce)
  }

  async insertGo(record: GoRecord): Promise<boolean> {
    if (this.gos.has(record.ticketId) || (await this.nonceUsed(record.go.nonce))) return false
    this.gos.set(record.ticketId, clone(record))
    return true
  }

  async consumeGo(ticketId: string, at: string, seq: number): Promise<boolean> {
    const g = this.gos.get(ticketId)
    if (!g || g.consumedAt !== null) return false
    g.consumedAt = at
    g.consumedSeq = seq
    return true
  }

  async getIdempotency(subject: string, key: string): Promise<IdempotencyRecord | null> {
    const r = this.idempotency.get(`${subject}\n${key}`)
    return r ? clone(r) : null
  }

  async putIdempotency(record: IdempotencyRecord): Promise<void> {
    const k = `${record.subject}\n${record.key}`
    if (!this.idempotency.has(k)) this.idempotency.set(k, clone(record))
  }

  async exportLines(): Promise<ExportLine[]> {
    const lines: ExportLine[] = [
      ...[...this.tickets.values()].map(ticketLine),
      ...this.messages.map((m): ExportLine => ({ type: 'message', ...m })),
      ...this.transitions.map((tr): ExportLine => ({ type: 'transition', ...tr })),
      ...[...this.artefacts.values()].map((a): ExportLine => ({ type: 'artefact', ...a })),
      ...[...this.gos.values()].flatMap(goLines),
      ...this.flags.map((f): ExportLine => ({ type: 'flag', ...f })),
    ]
    return clone(lines.sort((a, b) => a.seq - b.seq))
  }
}

export class MemoryBlobs implements Blobs {
  private readonly objects = new Map<string, Uint8Array>()

  async put(sha256: string, bytes: Uint8Array): Promise<void> {
    this.objects.set(sha256, new Uint8Array(bytes))
  }

  async get(sha256: string): Promise<Uint8Array<ArrayBuffer> | null> {
    const b = this.objects.get(sha256)
    return b ? new Uint8Array(b) : null
  }
}
