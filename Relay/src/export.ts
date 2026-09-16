/**
 * The JSONL export — what the validator mirrors into git on every poll.
 *
 * The partner plan's rule is that the repo is the record and the relay is
 * transport, so history must not live only in a system built by the party
 * being validated. That holds only if the export is complete enough to rebuild
 * the relay's state without the relay. `replayExport` is that rebuild, and the
 * tests hold it to reproducing every ticket and message exactly.
 */

import { initialState, setsAdjudicated } from './state'
import type { ArtefactMeta, ExportLine, GoRecord, Message, Ticket, TransitionRecord } from './types'

export function ticketLine(t: Ticket): ExportLine {
  return {
    type: 'ticket',
    seq: t.seq,
    id: t.id,
    ticketType: t.type,
    title: t.title,
    body: t.body,
    createdBy: t.createdBy,
    createdAt: t.createdAt,
    artefacts: t.artefacts,
    action: t.action,
    target: t.target,
    sha256: t.sha256,
    contentDigest: t.contentDigest,
    initialState: initialState(t.type),
  }
}

export function goLines(g: GoRecord): ExportLine[] {
  const lines: ExportLine[] = [
    {
      type: 'go',
      seq: g.seq,
      ticketId: g.ticketId,
      go: g.go,
      ownerKeyFingerprint: g.ownerKeyFingerprint,
      grantedAt: g.grantedAt,
    },
  ]
  if (g.consumedAt !== null && g.consumedSeq !== null) {
    lines.push({ type: 'go_consumed', seq: g.consumedSeq, ticketId: g.ticketId, at: g.consumedAt })
  }
  return lines
}

export function toJsonl(lines: ExportLine[]): string {
  return lines.map((l) => JSON.stringify(l) + '\n').join('')
}

export function parseJsonl(text: string): ExportLine[] {
  return text
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as ExportLine)
}

export interface Replayed {
  tickets: Ticket[]
  messages: Message[]
  transitions: TransitionRecord[]
  artefacts: ArtefactMeta[]
  gos: GoRecord[]
}

export function replayExport(lines: ExportLine[]): Replayed {
  const tickets = new Map<string, Ticket>()
  const messages: Message[] = []
  const transitions: TransitionRecord[] = []
  const artefacts: ArtefactMeta[] = []
  const gos = new Map<string, GoRecord>()

  const ticket = (id: string): Ticket => {
    const t = tickets.get(id)
    if (!t) throw new Error(`export references ticket ${id} before it is created`)
    return t
  }

  for (const line of [...lines].sort((a, b) => a.seq - b.seq)) {
    switch (line.type) {
      case 'ticket':
        tickets.set(line.id, {
          id: line.id,
          seq: line.seq,
          type: line.ticketType,
          title: line.title,
          body: line.body,
          state: line.initialState,
          createdBy: line.createdBy,
          createdAt: line.createdAt,
          updatedAt: line.createdAt,
          stateSince: line.createdAt,
          artefacts: line.artefacts,
          action: line.action,
          target: line.target,
          sha256: line.sha256,
          contentDigest: line.contentDigest,
          deployId: null,
          validatorStalled: false,
          lastValidatorAt: null,
          adjudicated: false,
        })
        break
      case 'message': {
        const { type: _type, ...message } = line
        messages.push(message)
        if (message.author === 'validator') ticket(message.ticketId).lastValidatorAt = message.createdAt
        break
      }
      case 'transition': {
        const { type: _type, ...tr } = line
        transitions.push(tr)
        const t = ticket(tr.ticketId)
        t.state = tr.to
        t.updatedAt = tr.at
        t.stateSince = tr.at
        if (tr.deployId !== null) t.deployId = tr.deployId
        if (setsAdjudicated(tr)) t.adjudicated = true
        if (tr.by === 'validator') t.lastValidatorAt = tr.at
        break
      }
      case 'flag':
        ticket(line.ticketId).validatorStalled = line.validatorStalled
        break
      case 'artefact': {
        const { type: _type, ...meta } = line
        artefacts.push(meta)
        break
      }
      case 'go':
        gos.set(line.ticketId, {
          ticketId: line.ticketId,
          seq: line.seq,
          go: line.go,
          ownerKeyFingerprint: line.ownerKeyFingerprint,
          grantedAt: line.grantedAt,
          consumedAt: null,
          consumedSeq: null,
        })
        break
      case 'go_consumed': {
        const g = gos.get(line.ticketId)
        if (g) {
          g.consumedAt = line.at
          g.consumedSeq = line.seq
        }
        break
      }
    }
  }

  return {
    tickets: [...tickets.values()].sort((a, b) => b.seq - a.seq),
    messages,
    transitions,
    artefacts,
    gos: [...gos.values()],
  }
}
