import { Elysia } from "elysia"
import type { SnapshotStore } from "../store"
import { isEntryStatus } from "../types"
import { createGuards, type GuardDeps } from "./guards"

export type QuotasDeps = GuardDeps & {
  store: SnapshotStore
}

export function createQuotasRoutes(deps: QuotasDeps) {
  const { store } = deps

  return new Elysia()
    .use(createGuards(deps))
    .get(
      "/quotas",
      ({ query, status }) => {
        const wanted = query.status
        if (wanted !== undefined && !isEntryStatus(wanted)) {
          return status(400, { error: `status không hợp lệ: ${wanted}` })
        }
        const entries = store.list({ provider: query.provider, status: wanted })
        return { count: entries.length, lastSweepAt: store.lastSweepAt(), entries }
      },
      { apiKey: true, needsToken: true }
    )
    .get(
      "/quotas/:id",
      ({ params, status }) => {
        const entry = store.get(params.id)
        if (!entry) return status(404, { error: `Không có connection ${params.id}` })
        return entry
      },
      { apiKey: true, needsToken: true }
    )
}
