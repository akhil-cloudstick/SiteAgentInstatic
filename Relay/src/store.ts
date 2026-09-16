/**
 * Persistence contract. `store.d1.ts` is production; `store.memory.ts` runs the
 * tests. Both must behave identically on the three atomic operations —
 * `applyTransition`, `insertGo` and `consumeGo` — because that is where two
 * concurrent callers would otherwise both succeed.
 */

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

export interface Store {
  /** Global, monotonic across every record type — the export's ordering. */
  nextSeq(): Promise<number>

  insertTicket(ticket: Ticket): Promise<void>
  getTicket(id: string): Promise<Ticket | null>
  /** Newest first. */
  listTickets(): Promise<Ticket[]>

  /**
   * Compare-and-set on `tr.from`, writing the transition record in the same
   * atomic step. False when the ticket had already moved.
   */
  applyTransition(tr: TransitionRecord, patch: { deployId?: string; adjudicated?: boolean }): Promise<boolean>
  listTransitions(ticketId: string): Promise<TransitionRecord[]>

  /** Stamps `lastValidatorAt`; when `flag` is given, also records the stall flag clearing. */
  recordValidatorActivity(ticketId: string, at: string, flag: FlagRecord | null): Promise<void>
  setStalled(flag: FlagRecord): Promise<void>

  insertMessage(message: Message): Promise<void>
  getMessage(id: string): Promise<Message | null>
  listMessages(ticketId: string): Promise<Message[]>

  getArtefact(sha256: string): Promise<ArtefactMeta | null>
  /** No-op when the hash is already held — artefacts are immutable. */
  insertArtefact(meta: ArtefactMeta): Promise<void>

  getGo(ticketId: string): Promise<GoRecord | null>
  nonceUsed(nonce: string): Promise<boolean>
  /** False when this ticket already has a GO or the nonce was used anywhere. */
  insertGo(record: GoRecord): Promise<boolean>
  /** False when the GO was already consumed. */
  consumeGo(ticketId: string, at: string, seq: number): Promise<boolean>

  getIdempotency(subject: string, key: string): Promise<IdempotencyRecord | null>
  putIdempotency(record: IdempotencyRecord): Promise<void>

  exportLines(): Promise<ExportLine[]>
}

/** Artefact bytes, keyed by their sha256. */
export interface Blobs {
  put(sha256: string, bytes: Uint8Array): Promise<void>
  get(sha256: string): Promise<Uint8Array<ArrayBuffer> | null>
}
