import { applyResult, pendingEntry } from "./normalize"
import type {
  AppliedResult,
  Connection,
  EntryStatus,
  QuotaEntry,
  StoredEntry
} from "./types"

export type SnapshotStoreOptions = {
  staleAfterMs: number
  now: () => number
}

export type ListFilter = {
  provider?: string | undefined
  status?: EntryStatus | undefined
}

export class SnapshotStore {
  #entries = new Map<string, StoredEntry>()
  #conns = new Map<string, Connection>()
  #lastSweepAt: string | null = null
  #staleAfterMs: number
  #now: () => number

  constructor(opts: SnapshotStoreOptions) {
    this.#staleAfterMs = opts.staleAfterMs
    this.#now = opts.now
  }

  syncConnections(conns: Connection[]): void {
    const seen = new Set<string>()

    for (const conn of conns) {
      seen.add(conn.id)
      this.#conns.set(conn.id, conn)

      const existing = this.#entries.get(conn.id)
      if (!existing) {
        this.#entries.set(conn.id, pendingEntry(conn))
        continue
      }

      // Giữ nguyên số liệu, chỉ làm tươi metadata.
      existing.entry.provider = conn.provider
      existing.entry.name = conn.name
      existing.entry.authType = conn.authType
    }

    for (const id of [...this.#entries.keys()]) {
      if (!seen.has(id)) this.remove(id)
    }
  }

  apply(conn: Connection, result: AppliedResult): void {
    const prev = this.#entries.get(conn.id) ?? null
    const nowIso = new Date(this.#now()).toISOString()
    this.#conns.set(conn.id, conn)
    this.#entries.set(conn.id, applyResult(prev, conn, result, nowIso))
  }

  remove(id: string): void {
    this.#entries.delete(id)
    this.#conns.delete(id)
  }

  get(id: string): QuotaEntry | null {
    const stored = this.#entries.get(id)
    return stored ? this.#withStale(stored) : null
  }

  list(filter: ListFilter = {}): QuotaEntry[] {
    const out: QuotaEntry[] = []
    for (const stored of this.#entries.values()) {
      if (filter.provider && stored.entry.provider !== filter.provider) continue
      if (filter.status && stored.entry.status !== filter.status) continue
      out.push(this.#withStale(stored))
    }
    return out
  }

  connections(): Connection[] {
    return [...this.#conns.values()]
  }

  size(): number {
    return this.#entries.size
  }

  markSweep(): void {
    this.#lastSweepAt = new Date(this.#now()).toISOString()
  }

  lastSweepAt(): string | null {
    return this.#lastSweepAt
  }

  #withStale(stored: StoredEntry): QuotaEntry {
    return { ...stored.entry, stale: this.#isStale(stored) }
  }

  #isStale(stored: StoredEntry): boolean {
    if (stored.failed) return true
    // Chưa có dữ liệu thì không có gì để mà cũ.
    if (stored.entry.fetchedAt === null) return false
    const age = this.#now() - Date.parse(stored.entry.fetchedAt)
    return age > this.#staleAfterMs
  }
}
