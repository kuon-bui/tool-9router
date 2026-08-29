import { Elysia } from "elysia"
import type { Config } from "../config"
import type { TokenProvider } from "../auth"
import type { Poller } from "../poller"
import type { SnapshotStore } from "../store"
import { createHealthRoutes } from "./health"
import { createQuotasRoutes } from "./quotas"
import { createRefreshRoutes } from "./refresh"

export type ServerDeps = {
  config: Config
  store: SnapshotStore
  poller: Poller
  tokens: TokenProvider
  now: () => number
}

export function createServer(deps: ServerDeps) {
  return new Elysia()
    .use(createHealthRoutes(deps))
    .use(createQuotasRoutes(deps))
    .use(createRefreshRoutes(deps))
}
