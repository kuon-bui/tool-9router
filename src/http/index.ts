import { Elysia } from "elysia"
import type { Config } from "../config"
import type { TokenProvider } from "../auth"
import type { RouterKeyCache } from "../guards/routerKeyCache"
import type { Poller } from "../poller"
import type { SnapshotStore } from "../store"
import { createHealthRoutes } from "./health"
import { createMcpRoutes } from "../mcp"
import { createQuotasRoutes } from "./quotas"
import { createQuotaService } from "./quotaService"
import { createRefreshRoutes } from "./refresh"

export type ServerDeps = {
  config: Config
  store: SnapshotStore
  poller: Poller
  tokens: TokenProvider
  now: () => number
  routerKeys?: RouterKeyCache | null
}

export function createServer(deps: ServerDeps) {
  const { config, store, poller, tokens, now, routerKeys } = deps
  const quotaService = createQuotaService({ store, poller, config, now })

  return new Elysia()
    .use(createHealthRoutes({ store, poller, tokens }))
    .use(createQuotasRoutes({ config, tokens, routerKeys, quotaService }))
    .use(createRefreshRoutes({ config, tokens, routerKeys, quotaService }))
    .use(createMcpRoutes({ config, tokens, routerKeys, quotaService }))
}
