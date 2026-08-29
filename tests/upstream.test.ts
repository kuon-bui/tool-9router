import { afterEach, describe, expect, it } from "bun:test"
import { startFakeRouter, type FakeRouter } from "./fixtures/fakeRouter"
import { UpstreamClient } from "../src/upstream"
import type { TokenProvider } from "../src/cliToken"

const tokens: TokenProvider = {
  get: async () => "abcdef0123456789",
  isReady: () => true
}

let router: FakeRouter | null = null

afterEach(async () => {
  await router?.stop()
  router = null
})

function client(baseUrl: string, timeoutMs = 5_000): UpstreamClient {
  return new UpstreamClient({ baseUrl, timeoutMs, tokens })
}

describe("listConnections", () => {
  it("trả danh sách đã chuẩn hoá", async () => {
    router = await startFakeRouter({
      connections: {
        connections: [
          { id: "c1", provider: "kiro", authType: "oauth", name: "Kiro #1", apiKey: "phải bị bỏ" }
        ]
      }
    })

    const conns = await client(router.url).listConnections()
    expect(conns).toEqual([{ id: "c1", provider: "kiro", name: "Kiro #1", authType: "oauth" }])
  })

  it("gửi header x-9r-cli-token", async () => {
    router = await startFakeRouter({ requireToken: "abcdef0123456789" })
    await client(router.url).listConnections()
    expect(router.calls[0]?.token).toBe("abcdef0123456789")
  })

  it("ném lỗi khi 9Router trả lỗi", async () => {
    router = await startFakeRouter({ requireToken: "token-khac" })
    await expect(client(router.url).listConnections()).rejects.toThrow(/401/)
  })

  it("ném lỗi khi không kết nối được", async () => {
    await expect(client("http://127.0.0.1:1").listConnections()).rejects.toThrow()
  })
})

describe("fetchUsage", () => {
  it("200 có quotas -> kind quotas", async () => {
    router = await startFakeRouter({
      usage: {
        c1: {
          status: 200,
          body: { plan: "Kiro Pro", quotas: { credit: { used: 12.5, total: 50 } } }
        }
      }
    })

    const result = await client(router.url).fetchUsage("c1")
    expect(result.kind).toBe("quotas")
  })

  it("200 có message -> kind message", async () => {
    router = await startFakeRouter({
      usage: { c1: { status: 200, body: { message: "Usage not available for this connection" } } }
    })
    expect((await client(router.url).fetchUsage("c1")).kind).toBe("message")
  })

  it("401 -> kind unauthorized", async () => {
    router = await startFakeRouter({ usage: { c1: { status: 401, body: { error: "Unauthorized" } } } })
    expect((await client(router.url).fetchUsage("c1")).kind).toBe("unauthorized")
  })

  it("404 -> kind missing", async () => {
    router = await startFakeRouter({})
    expect((await client(router.url).fetchUsage("khong-co")).kind).toBe("missing")
  })

  it("500 -> kind error thay vì ném", async () => {
    router = await startFakeRouter({ usage: { c1: { status: 500, body: { error: "boom" } } } })
    expect((await client(router.url).fetchUsage("c1")).kind).toBe("error")
  })

  it("mặc định không gửi force", async () => {
    router = await startFakeRouter({ usage: { c1: { status: 200, body: { quotas: {} } } } })
    await client(router.url).fetchUsage("c1")
    expect(router.calls.at(-1)?.query.force).toBeUndefined()
  })

  it("gửi force=1 khi được yêu cầu", async () => {
    router = await startFakeRouter({ usage: { c1: { status: 200, body: { quotas: {} } } } })
    await client(router.url).fetchUsage("c1", true)
    expect(router.calls.at(-1)?.query.force).toBe("1")
  })

  it("timeout -> kind error, không treo", async () => {
    router = await startFakeRouter({
      usage: { c1: { status: 200, body: { quotas: {} } } },
      delayMs: 200
    })
    const result = await client(router.url, 30).fetchUsage("c1")
    expect(result.kind).toBe("error")
  })

  it("không kết nối được -> kind error", async () => {
    const result = await client("http://127.0.0.1:1").fetchUsage("c1")
    expect(result.kind).toBe("error")
  })
})
