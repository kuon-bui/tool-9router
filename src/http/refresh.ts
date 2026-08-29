import { Elysia } from "elysia"
import type { Config } from "../config"
import type { Poller } from "../poller"
import type { SnapshotStore } from "../store"
import { createGuards, type GuardDeps } from "./guards"

export type RefreshDeps = GuardDeps & {
  store: SnapshotStore
  poller: Poller
  config: Config
  now: () => number
}

export function createRefreshRoutes(deps: RefreshDeps) {
  const { store, poller, config, now } = deps
  const lastRefreshAt = new Map<string, number>()

  return new Elysia()
    .use(createGuards(deps))
    .post(
      "/refresh",
      ({ status }) => {
        void poller.sweep()
        return status(202, { accepted: true, connections: store.size() })
      },
      { apiKey: true, needsToken: true }
    )
    .post(
      "/refresh/:id",
      async ({ params, query, status }) => {
        if (!store.get(params.id)) {
          return status(404, { error: `Không có connection ${params.id}` })
        }

        const last = lastRefreshAt.get(params.id)
        const elapsed = last === undefined ? Infinity : now() - last
        if (elapsed < config.refreshCooldownMs) {
          const retryAfter = Math.ceil((config.refreshCooldownMs - elapsed) / 1000)
          return status(429, { error: "Đang trong cooldown refresh", retryAfter })
        }

        lastRefreshAt.set(params.id, now())
        const entry = await poller.refreshOne(params.id, query.force === "1")
        if (!entry) return status(404, { error: `Không có connection ${params.id}` })
        return entry
      },
      { apiKey: true, needsToken: true }
    )
}
