import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { startFakeRouter, type FakeRouter } from "./fixtures/fakeRouter"
import { createServer } from "../src/server"
import { Poller } from "../src/poller"
import { SerialQueue } from "../src/queue"
import { SnapshotStore } from "../src/store"
import { UpstreamClient } from "../src/upstream"
import { loadConfig } from "../src/config"
import type { TokenProvider } from "../src/cliToken"

const API_KEY = "test-api-key"

let router: FakeRouter | null = null
let queue: SerialQueue | null = null
let app: ReturnType<typeof createServer> | null = null
let store: SnapshotStore
let poller: Poller
let clock: number
let tokenReady: boolean

const tokens: TokenProvider = {
  get: async () => {
    if (!tokenReady) throw new Error("chưa có machine-id")
    return "abcdef0123456789"
  },
  isReady: () => tokenReady
}

const twoConnections = {
  connections: [
    { id: "c1", provider: "kiro", authType: "oauth", name: "Kiro #1" },
    { id: "c2", provider: "codex", authType: "oauth", name: "Codex" }
  ]
}

async function boot(usage: Record<string, { status: 200 | 401 | 404 | 500; body: unknown }>) {
  router = await startFakeRouter({ connections: twoConnections, usage })
  clock = 1_000_000
  tokenReady = true
  store = new SnapshotStore({ staleAfterMs: 600_000, now: () => clock })
  queue = new SerialQueue({ delayMs: 0 })
  const upstream = new UpstreamClient({ baseUrl: router.url, timeoutMs: 2_000, tokens })
  poller = new Poller({ upstream, store, queue, intervalMs: 60_000 })
  const config = loadConfig({ API_KEY, REFRESH_COOLDOWN_MS: "60000" })
  app = createServer({ config, store, poller, tokens, now: () => clock })
  await poller.sweep()
}

function req(path: string, init: RequestInit = {}): Request {
  return new Request(`http://localhost${path}`, init)
}

function authed(path: string, init: RequestInit = {}): Request {
  return req(path, { ...init, headers: { ...(init.headers ?? {}), "x-api-key": API_KEY } })
}

beforeEach(() => {
  tokenReady = true
})

afterEach(async () => {
  await queue?.stop()
  queue = null
  await router?.stop()
  router = null
  app = null
})

describe("xác thực", () => {
  beforeEach(async () => {
    await boot({ c1: { status: 200, body: { quotas: { credit: { used: 1 } } } } })
  })

  it("/quotas không có key -> 401", async () => {
    const res = await app!.handle(req("/quotas"))
    expect(res.status).toBe(401)
  })

  it("/quotas sai key -> 401", async () => {
    const res = await app!.handle(req("/quotas", { headers: { "x-api-key": "sai" } }))
    expect(res.status).toBe(401)
  })

  it("/quotas đúng key -> 200", async () => {
    const res = await app!.handle(authed("/quotas"))
    expect(res.status).toBe(200)
  })

  it("/health không cần key", async () => {
    const res = await app!.handle(req("/health"))
    expect(res.status).toBe(200)
  })

  it("/health không lộ CLI token hay API key", async () => {
    const res = await app!.handle(req("/health"))
    const text = await res.text()
    expect(text).not.toContain("abcdef0123456789")
    expect(text).not.toContain(API_KEY)
  })
})

describe("GET /quotas", () => {
  beforeEach(async () => {
    await boot({
      c1: { status: 200, body: { plan: "Kiro Pro", quotas: { credit: { used: 1, total: 2 } } } },
      c2: { status: 200, body: { message: "Usage not available for this connection" } }
    })
  })

  it("trả mọi entry", async () => {
    const body = (await (await app!.handle(authed("/quotas"))).json()) as any
    expect(body.entries.length).toBe(2)
    expect(body.count).toBe(2)
  })

  it("lọc theo provider", async () => {
    const body = (await (await app!.handle(authed("/quotas?provider=kiro"))).json()) as any
    expect(body.entries.map((e: any) => e.connectionId)).toEqual(["c1"])
  })

  it("lọc theo status", async () => {
    const body = (await (await app!.handle(authed("/quotas?status=unavailable"))).json()) as any
    expect(body.entries.map((e: any) => e.connectionId)).toEqual(["c2"])
  })

  it("status không hợp lệ -> 400", async () => {
    const res = await app!.handle(authed("/quotas?status=nonsense"))
    expect(res.status).toBe(400)
  })

  it("giữ nguyên tên pool của provider", async () => {
    const body = (await (await app!.handle(authed("/quotas?provider=kiro"))).json()) as any
    expect(Object.keys(body.entries[0].quotas)).toEqual(["credit"])
  })
})

describe("GET /quotas/:id", () => {
  beforeEach(async () => {
    await boot({ c1: { status: 200, body: { quotas: { credit: { used: 1 } } } } })
  })

  it("trả đúng entry", async () => {
    const body = (await (await app!.handle(authed("/quotas/c1"))).json()) as any
    expect(body.connectionId).toBe("c1")
  })

  it("id lạ -> 404", async () => {
    const res = await app!.handle(authed("/quotas/khong-co"))
    expect(res.status).toBe(404)
  })
})

describe("POST /refresh", () => {
  beforeEach(async () => {
    await boot({
      c1: { status: 200, body: { quotas: { credit: { used: 1 } } } },
      c2: { status: 200, body: { quotas: { credit: { used: 2 } } } }
    })
  })

  it("trả 202 ngay, không chờ quét xong", async () => {
    const res = await app!.handle(authed("/refresh", { method: "POST" }))
    expect(res.status).toBe(202)
  })
})

describe("POST /refresh/:id", () => {
  beforeEach(async () => {
    await boot({ c1: { status: 200, body: { quotas: { credit: { used: 1 } } } } })
  })

  it("trả entry mới nhất", async () => {
    router!.setUsage("c1", { status: 200, body: { quotas: { credit: { used: 9 } } } })
    const body = (await (await app!.handle(authed("/refresh/c1", { method: "POST" }))).json()) as any
    expect(body.quotas.credit.used).toBe(9)
  })

  it("gọi lần hai trong cooldown -> 429 kèm retryAfter", async () => {
    await app!.handle(authed("/refresh/c1", { method: "POST" }))
    const res = await app!.handle(authed("/refresh/c1", { method: "POST" }))
    expect(res.status).toBe(429)
    const body = (await res.json()) as any
    expect(body.retryAfter).toBeGreaterThan(0)
  })

  it("hết cooldown thì gọi lại được", async () => {
    await app!.handle(authed("/refresh/c1", { method: "POST" }))
    clock += 60_001
    const res = await app!.handle(authed("/refresh/c1", { method: "POST" }))
    expect(res.status).toBe(200)
  })

  it("id lạ -> 404", async () => {
    const res = await app!.handle(authed("/refresh/khong-co", { method: "POST" }))
    expect(res.status).toBe(404)
  })

  it("force=1 được chuyển xuống upstream", async () => {
    await app!.handle(authed("/refresh/c1?force=1", { method: "POST" }))
    expect(router!.calls.at(-1)?.query.force).toBe("1")
  })
})

describe("khi chưa có CLI token", () => {
  beforeEach(async () => {
    await boot({ c1: { status: 200, body: { quotas: { credit: { used: 1 } } } } })
    tokenReady = false
  })

  it("/quotas -> 503 kèm hướng dẫn", async () => {
    const res = await app!.handle(authed("/quotas"))
    expect(res.status).toBe(503)
    const body = (await res.json()) as any
    expect(body.error).toMatch(/9Router/)
  })

  it("/health -> tokenReady false, ok false", async () => {
    const body = (await (await app!.handle(req("/health"))).json()) as any
    expect(body.tokenReady).toBe(false)
    expect(body.ok).toBe(false)
  })
})

describe("khi 9Router sập", () => {
  it("vẫn trả snapshot cũ với stale true", async () => {
    await boot({ c1: { status: 200, body: { quotas: { credit: { used: 1 } } } } })
    await router!.stop()
    router = null
    await poller.sweep()

    const body = (await (await app!.handle(authed("/quotas/c1"))).json()) as any
    expect(body.quotas.credit.used).toBe(1)
    expect(body.stale).toBe(true)

    const health = (await (await app!.handle(req("/health"))).json()) as any
    expect(health.upstream).toBe("down")
  })
})
