import { Elysia } from "elysia"
import { timingSafeEqual } from "node:crypto"
import type { Config } from "../config"
import type { TokenProvider } from "../auth"
import type { Poller } from "../poller"
import type { SnapshotStore } from "../store"
import { isEntryStatus } from "../types"

export type ServerDeps = {
  config: Config
  store: SnapshotStore
  poller: Poller
  tokens: TokenProvider
  now: () => number
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8")
  const right = Buffer.from(b, "utf8")
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

const TOKEN_HINT =
  "Chưa đọc được CLI token. Hãy chạy 9Router một lần để nó sinh machine-id và auth/cli-secret."

export function createServer(deps: ServerDeps) {
  const { config, store, poller, tokens, now } = deps
  const lastRefreshAt = new Map<string, number>()

  return new Elysia()
    .macro({
      apiKey: {
        resolve({ headers, status }) {
          const provided = headers["x-api-key"]
          if (typeof provided !== "string" || !safeEqual(provided, config.apiKey)) {
            return status(401, { error: "Unauthorized" })
          }
          return {}
        }
      },
      needsToken: {
        resolve({ status }) {
          // bootstrap() đã tính token trước khi listen(), nên tới đây token hoặc
          // đã sẵn sàng, hoặc thật sự đọc không được.
          if (!tokens.isReady()) return status(503, { error: TOKEN_HINT })
          return {}
        }
      }
    })

    .get("/health", () => ({
      ok: tokens.isReady() && poller.upstreamHealthy(),
      upstream: poller.upstreamHealthy() ? "up" : "down",
      tokenReady: tokens.isReady(),
      hint: tokens.isReady() ? null : TOKEN_HINT,
      connections: store.size(),
      lastSweepAt: store.lastSweepAt()
    }))

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
