/**
 * ContentSnapshot — payload the chat handler hands to content-scope tool
 * handlers via `ToolContext.snapshot`.
 *
 * The browser builds this on every send from the live content workspace
 * state (active document, active collection, the full collection list).
 * Shape stays loose for the same reason as SiteSnapshot — the boundary
 * validation lives in the chat handler.
 *
 * Body content is exchanged as **markdown**. The browser bridge converts
 * Tiptap JSON ↔ markdown on read/write so the model only ever sees a
 * compact string instead of a deeply nested ProseMirror node tree.
 *
 * The docblock below used to say the boundary validation "lives in the chat
 * handler". For the site snapshot it does; for this one it did not — the
 * handler cast the raw HTTP body with `as ContentSnapshot` and handed it
 * straight to the prompt builder, which interpolates its values into the
 * SYSTEM prompt. `ContentSnapshotSchema` is that missing validation.
 */
import { Type, type Static } from '@sinclair/typebox'

export interface ContentSnapshot {
  /** Every postType / page collection in the site (lightweight). */
  collections: CollectionSummary[]
  /** Selected collection in the sidebar; null when nothing is selected. */
  activeTableId: string | null
  /** Currently-open document, if any — the agent's primary editing target. */
  activeDocument: ActiveDocument | null
  /** Caller's identity so the agent can reason about authorship. */
  currentUser: CurrentUserInfo
}

interface CollectionSummary {
  id: string
  slug: string
  /** Display label (`pluralLabel` from DataTable — "Posts", "Pages"). */
  label: string
  /** 'postType' | 'page' | 'data' | 'component' — agents care about the first two. */
  kind: string
  /** Live row count excluding soft-deleted. */
  docCount: number
}

export interface ActiveDocument {
  id: string
  tableId: string
  /** Resolved primary-field value — usually the title. */
  title: string
  slug: string
  status: 'draft' | 'unpublished' | 'published' | 'scheduled'
  /** Per-field current value; body field is markdown, not Tiptap JSON. */
  fields: Record<string, unknown>
  /** Snapshot of the collection's field schema for the model's reference. */
  schema: FieldInfo[]
  authorUserId: string | null
  updatedAt: string
}

interface FieldInfo {
  id: string
  label: string
  /** Field type tag from `@core/data/schemas` → `DataFieldType`. */
  type: string
  required: boolean
  /** True for built-in fields (title/slug/body/...) that can't be renamed. */
  builtIn: boolean
  /** For `select`/`multiSelect`: the allowed option ids + labels. */
  options?: Array<{ value: string; label: string }>
  /** For `relation`: the target collection slug. */
  targetTableSlug?: string
  /** For `media`: 'image' | 'video' | 'document' | 'any' (when set). */
  mediaKind?: string
  /** For `media` / `relation`: true when multiple values are allowed. */
  allowMultiple?: boolean
}

interface CurrentUserInfo {
  id: string
  displayName: string
  email: string
}

// ---------------------------------------------------------------------------
// Boundary validation
// ---------------------------------------------------------------------------

/**
 * Runtime shape of `ContentSnapshot`, for validating the untyped HTTP body.
 *
 * Deliberately permissive where the interface is permissive — `fields` really
 * is `Record<string, unknown>` and callers add keys — but strict about the
 * parts the system prompt reads and prints: the collection list, the active
 * document's identity, and the field schema. Those are the values that end up
 * inside the highest-trust part of the request, so "a string where a string was
 * promised" is the whole point.
 *
 * `additionalProperties` is left open so a browser running slightly ahead of
 * the server does not have its whole snapshot rejected over one new key. The
 * fallback on failure is an EMPTY snapshot, never a partially-trusted one.
 */
const FieldInfoSchema = Type.Object({
  id: Type.String(),
  label: Type.String(),
  type: Type.String(),
  required: Type.Boolean(),
  builtIn: Type.Boolean(),
  options: Type.Optional(Type.Array(Type.Object({ value: Type.String(), label: Type.String() }))),
  targetTableSlug: Type.Optional(Type.String()),
  mediaKind: Type.Optional(Type.String()),
  allowMultiple: Type.Optional(Type.Boolean()),
})

const ActiveDocumentSchema = Type.Object({
  id: Type.String(),
  tableId: Type.String(),
  title: Type.String(),
  slug: Type.String(),
  status: Type.Union([
    Type.Literal('draft'),
    Type.Literal('unpublished'),
    Type.Literal('published'),
    Type.Literal('scheduled'),
  ]),
  fields: Type.Record(Type.String(), Type.Unknown()),
  schema: Type.Array(FieldInfoSchema),
  authorUserId: Type.Union([Type.String(), Type.Null()]),
  updatedAt: Type.String(),
})

const CollectionSummarySchema = Type.Object({
  id: Type.String(),
  slug: Type.String(),
  label: Type.String(),
  kind: Type.String(),
  docCount: Type.Number(),
})

export const ContentSnapshotSchema = Type.Object({
  collections: Type.Array(CollectionSummarySchema),
  activeTableId: Type.Union([Type.String(), Type.Null()]),
  activeDocument: Type.Union([ActiveDocumentSchema, Type.Null()]),
  currentUser: Type.Object({
    id: Type.String(),
    displayName: Type.String(),
    email: Type.String(),
  }),
})

export type ContentSnapshotValidated = Static<typeof ContentSnapshotSchema>
