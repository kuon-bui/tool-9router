import { afterEach, describe, expect, it } from "bun:test"
import { startFakeRouter, type FakeRouter } from "./fixtures/fakeRouter"
import { Poller } from "../src/poller"
import { SerialQueue } from "../src/queue"
import { SnapshotStore } from "../src/store"
import { UpstreamClient } from "../src/upstream"
import type { TokenProvider } from "../src/cliToken"

const tokens: TokenProvider = {
  get: async () => "abcdef0123456789",
  isReady: () => true
}

let router: FakeRouter | null = null
let queue: SerialQueue | null = null

afterEach(async () => {
  await queue?.stop()
  queue = null
  await router?.stop()
  router = null
})

function build(url: string) {
  const store = new SnapshotStore({ staleAfterMs: 600_000, now: () => Date.now() })
  queue = new SerialQueue({ delayMs: 0 })
  const upstream = new UpstreamClient({ baseUrl: url, timeoutMs: 2_000, tokens })
  const poller = new Poller({ upstream, store, queue, intervalMs: 60_000 })
  return { store, poller }
}

const twoConnections = {
  connections: [
    { id: "c1", provider: "kiro", authType: "oauth", name: "Kiro #1" },
    { id: "c2", provider: "codex", authType: "oauth", name: "Codex" }
  ]
}

describe("sweep", () => {
  it("nạp snapshot cho mọi connection", async () => {
    router = await startFakeRouter({
      connections: twoConnections,
      usage: {
        c1: { status: 200, body: { plan: "Kiro Pro", quotas: { credit: { used: 1, total: 2 } } } },
        c2: { status: 200, body: { message: "Usage not available for this connection" } }
      }
    })

    const { store, poller } = build(router.url)
    await poller.sweep()

    expect(store.get("c1")?.status).toBe("ok")
    expect(store.get("c2")?.status).toBe("unavailable")
    expect(store.lastSweepAt()).not.toBeNull()
  })

  it("không bao giờ gửi force trong vòng quét nền", async () => {
    router = await startFakeRouter({
      connections: twoConnections,
      usage: {
        c1: { status: 200, body: { quotas: {} } },
        c2: { status: 200, body: { quotas: {} } }
      }
    })

    const { poller } = build(router.url)
    await poller.sweep()

    const usageCalls = router.calls.filter((c) => c.path.startsWith("/api/usage/"))
    expect(usageCalls.length).toBe(2)
    expect(usageCalls.every((c) => c.query.force === undefined)).toBe(true)
  })

  it("gỡ connection khi 9Router trả 404", async () => {
    router = await startFakeRouter({
      connections: twoConnections,
      usage: { c1: { status: 200, body: { quotas: {} } } }
    })

    const { store, poller } = build(router.url)
    await poller.sweep()

    expect(store.get("c1")?.status).toBe("ok")
    expect(store.get("c2")).toBeNull()
  })

  it("một connection lỗi không làm hỏng cả vòng quét", async () => {
    router = await startFakeRouter({
      connections: twoConnections,
      usage: {
        c1: { status: 500, body: { error: "boom" } },
        c2: { status: 200, body: { quotas: { credit: { used: 1 } } } }
      }
    })

    const { store, poller } = build(router.url)
    await poller.sweep()

    expect(store.get("c1")?.status).toBe("error")
    expect(store.get("c2")?.status).toBe("ok")
  })

  it("giữ snapshot cũ và báo upstream không khoẻ khi 9Router sập", async () => {
    router = await startFakeRouter({
      connections: twoConnections,
      usage: { c1: { status: 200, body: { quotas: { credit: { used: 1 } } } } }
    })

    const { store, poller } = build(router.url)
    await poller.sweep()
    expect(poller.upstreamHealthy()).toBe(true)

    await router.stop()
    router = null
    await poller.sweep()

    expect(poller.upstreamHealthy()).toBe(false)
    expect(store.get("c1")?.status).toBe("ok")
    expect(store.get("c1")?.quotas).not.toBeNull()
  })
})

describe("refreshOne", () => {
  it("trả entry mới nhất", async () => {
    router = await startFakeRouter({
      connections: twoConnections,
      usage: { c1: { status: 200, body: { quotas: { credit: { used: 1 } } } } }
    })

    const { poller } = build(router.url)
    await poller.sweep()

    router.setUsage("c1", { status: 200, body: { quotas: { credit: { used: 9 } } } })
    const entry = await poller.refreshOne("c1", false)

    expect(entry?.quotas?.credit?.used).toBe(9)
  })

  it("gửi force=1 khi được yêu cầu", async () => {
    router = await startFakeRouter({
      connections: twoConnections,
      usage: { c1: { status: 200, body: { quotas: {} } } }
    })

    const { poller } = build(router.url)
    await poller.sweep()
    await poller.refreshOne("c1", true)

    expect(router.calls.at(-1)?.query.force).toBe("1")
  })

  it("trả null khi connection không có trong snapshot", async () => {
    router = await startFakeRouter({ connections: { connections: [] } })
    const { poller } = build(router.url)
    await poller.sweep()
    expect(await poller.refreshOne("khong-co", false)).toBeNull()
  })
})
