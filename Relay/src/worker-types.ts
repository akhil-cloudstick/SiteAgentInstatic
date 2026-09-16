/**
 * The slice of the Cloudflare Workers runtime this relay uses, declared here so
 * the project has no install step. Matches the shapes in
 * `@cloudflare/workers-types`; swap to that package if it is ever added.
 */

export interface D1Result<T = unknown> {
  results: T[]
  meta: { changes: number }
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement
  first<T = unknown>(): Promise<T | null>
  all<T = unknown>(): Promise<D1Result<T>>
  run(): Promise<D1Result>
}

export interface D1Database {
  prepare(sql: string): D1PreparedStatement
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>
}

export interface R2ObjectBody {
  arrayBuffer(): Promise<ArrayBuffer>
}

export interface R2Bucket {
  put(
    key: string,
    value: ArrayBuffer | Uint8Array,
    options?: { sha256?: string; customMetadata?: Record<string, string> },
  ): Promise<unknown>
  get(key: string): Promise<R2ObjectBody | null>
}

export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void
}

export interface ScheduledController {
  scheduledTime: number
  cron: string
}
