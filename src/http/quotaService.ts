import type { Config } from "../config"
import type { Poller } from "../poller"
import type { SnapshotStore } from "../store"
import type { EntryStatus, QuotaEntry } from "../types"

export type QuotaListFilter = {
  provider?: string | undefined
  status?: EntryStatus | undefined
}

export type QuotaListResult = {
  count: number
  lastSweepAt: string | null
  entries: QuotaEntry[]
}

export type SweepAccepted = {
  accepted: true
  connections: number
}

export type RefreshOutcome =
  | { kind: "ok"; entry: QuotaEntry }
  | { kind: "notFound" }
  | { kind: "cooldown"; retryAfterSeconds: number }

export type QuotaServiceDeps = {
  store: SnapshotStore
  poller: Poller
  config: Config
  now: () => number
}

/**
 * Logic nghiệp vụ của miền quota, tách khỏi HTTP: route không đụng
 * SnapshotStore/Poller trực tiếp nữa, chỉ gọi qua đây. Test được mà không cần
 * dựng Elysia.
 */
export function createQuotaService(deps: QuotaServiceDeps) {
  const { store, poller, config, now } = deps
  const lastRefreshAt = new Map<string, number>()

  return {
    list(filter: QuotaListFilter): QuotaListResult {
      const entries = store.list(filter)
      return { count: entries.length, lastSweepAt: store.lastSweepAt(), entries }
    },

    get(id: string): QuotaEntry | null {
      return store.get(id)
    },

    triggerSweep(): SweepAccepted {
      void poller.sweep()
      return { accepted: true, connections: store.size() }
    },

    async refreshOne(id: string, force: boolean): Promise<RefreshOutcome> {
      if (!store.get(id)) return { kind: "notFound" }

      const last = lastRefreshAt.get(id)
      const elapsed = last === undefined ? Infinity : now() - last
      if (elapsed < config.refreshCooldownMs) {
        return {
          kind: "cooldown",
          retryAfterSeconds: Math.ceil((config.refreshCooldownMs - elapsed) / 1000)
        }
      }

      lastRefreshAt.set(id, now())
      const entry = await poller.refreshOne(id, force)
      if (!entry) return { kind: "notFound" }
      return { kind: "ok", entry }
    }
  }
}

export type QuotaService = ReturnType<typeof createQuotaService>
