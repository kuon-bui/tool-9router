import { Elysia } from "elysia"
import type { TokenProvider } from "../auth"
import type { Poller } from "../poller"
import type { SnapshotStore } from "../store"
import { TOKEN_HINT } from "../guards"
import { healthSchema } from "./schemas"

export type HealthDeps = {
  store: SnapshotStore
  poller: Poller
  tokens: TokenProvider
}

/** Không cần apiKey — dùng làm probe cho load balancer / docker healthcheck. */
export function createHealthRoutes({ store, poller, tokens }: HealthDeps) {
  return new Elysia().get(
    "/health",
    () => ({
      ok: tokens.isReady() && poller.upstreamHealthy(),
      upstream: poller.upstreamHealthy() ? ("up" as const) : ("down" as const),
      tokenReady: tokens.isReady(),
      hint: tokens.isReady() ? null : TOKEN_HINT,
      connections: store.size(),
      lastSweepAt: store.lastSweepAt()
    }),
    { response: { 200: healthSchema } }
  )
}
