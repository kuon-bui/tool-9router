import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { startFakeRouter, type FakeRouter } from "../fixtures/fakeRouter"
import { createServer } from "../../src/http"
import { Poller } from "../../src/poller"
import { SerialQueue } from "../../src/queue"
import { SnapshotStore } from "../../src/store"
import { UpstreamClient } from "../../src/upstream"
import { loadConfig } from "../../src/config"
import type { TokenProvider } from "../../src/auth"

const API_KEY = "test-mcp-key"

let router: FakeRouter | null = null
let queue: SerialQueue | null = null
let app: ReturnType<typeof createServer> | null = null

const tokens: TokenProvider = {
  get: async () => "abcdef0123456789",
  isReady: () => true
}

async function boot() {
  router = await startFakeRouter({
    connections: { connections: [{ id: "c1", provider: "kiro", authType: "oauth", name: "Kiro #1" }] },
    usage: { c1: { status: 200, body: { plan: "Kiro Pro", quotas: { credit: { used: 1, total: 2 } } } } }
  })
  const store = new SnapshotStore({ staleAfterMs: 600_000, now: () => Date.now() })
  queue = new SerialQueue({ delayMs: 0 })
  const upstream = new UpstreamClient({ baseUrl: router.url, timeoutMs: 2_000, tokens })
  const poller = new Poller({ upstream, store, queue, intervalMs: 60_000 })
  const config = loadConfig({ API_KEY, REFRESH_COOLDOWN_MS: "60000" })
  app = createServer({ config, store, poller, tokens, now: () => Date.now() })
  await poller.sweep()
}

beforeEach(async () => {
  await boot()
})

afterEach(async () => {
  await queue?.stop()
  queue = null
  await router?.stop()
  router = null
  app = null
})

function parseSseJson(text: string): any {
  const line = text.split("\n").find((l) => l.startsWith("data: "))
  if (!line) throw new Error(`Không tìm thấy dòng "data:" trong body SSE:\n${text}`)
  return JSON.parse(line.slice("data: ".length))
}

let nextId = 1
function rpc(method: string, params?: unknown, headers: Record<string, string> = {}): Request {
  const id = nextId++
  return new Request("http://localhost/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "x-api-key": API_KEY,
      ...headers
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params })
  })
}

describe("xác thực /mcp", () => {
  it("thiếu key -> 401", async () => {
    const req = new Request("http://localhost/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
    })
    const res = await app!.handle(req)
    expect(res.status).toBe(401)
  })

  it("sai key -> 401", async () => {
    const res = await app!.handle(rpc("tools/list", undefined, { "x-api-key": "sai" }))
    expect(res.status).toBe(401)
  })

  it("Authorization: Bearer đúng key -> 200", async () => {
    const req = new Request("http://localhost/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${API_KEY}`
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
    })
    const res = await app!.handle(req)
    expect(res.status).toBe(200)
  })
})

describe("giao thức JSON-RPC", () => {
  it("initialize trả protocolVersion và serverInfo", async () => {
    const res = await app!.handle(
      rpc("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "0.0.1" }
      })
    )
    expect(res.status).toBe(200)
    const body = parseSseJson(await res.text())
    expect(body.result.serverInfo.name).toBe("9router-quota-server")
  })

  it("tools/list liệt kê đúng 3 tool và KHÔNG có tham số force ở refresh_quota", async () => {
    const res = await app!.handle(rpc("tools/list"))
    const body = parseSseJson(await res.text())
    const names = body.result.tools.map((t: any) => t.name).sort()
    expect(names).toEqual(["get_quota", "list_quotas", "refresh_quota"])

    const refreshTool = body.result.tools.find((t: any) => t.name === "refresh_quota")
    const props = refreshTool.inputSchema.properties ?? {}
    expect(Object.keys(props)).not.toContain("force")
  })

  it("tools/call list_quotas trả text có tên connection", async () => {
    const res = await app!.handle(rpc("tools/call", { name: "list_quotas", arguments: {} }))
    const body = parseSseJson(await res.text())
    expect(body.result.content[0].text).toContain("kiro")
  })

  it("tools/call get_quota với id không tồn tại trả isError", async () => {
    const res = await app!.handle(
      rpc("tools/call", { name: "get_quota", arguments: { connection_id: "khong-co" } })
    )
    const body = parseSseJson(await res.text())
    expect(body.result.isError).toBe(true)
  })

  it("tools/call refresh_quota trả entry vừa làm tươi", async () => {
    const res = await app!.handle(
      rpc("tools/call", { name: "refresh_quota", arguments: { connection_id: "c1" } })
    )
    const body = parseSseJson(await res.text())
    expect(body.result.isError).toBeUndefined()
    expect(body.result.content[0].text).toContain("Vừa làm tươi")
  })
})
