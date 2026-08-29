import { describe, expect, it } from "bun:test"
import { createMcpTools, type McpToolsDeps } from "../../src/mcp/tools"
import type { QuotaEntry } from "../../src/types"

const okEntry: QuotaEntry = {
  connectionId: "c1",
  provider: "kiro",
  name: "Kiro #1",
  authType: "oauth",
  status: "ok",
  plan: "Kiro Pro",
  quotas: { credit: { used: 1, total: 2, remaining: 1, resetAt: null, unlimited: false } },
  message: null,
  fetchedAt: "2026-08-29T09:00:00.000Z",
  stale: false
}

function fakeService(overrides: Partial<McpToolsDeps["quotaService"]> = {}): McpToolsDeps["quotaService"] {
  return {
    list: overrides.list ?? (() => ({ count: 1, lastSweepAt: "2026-08-29T09:00:00.000Z", entries: [okEntry] })),
    get: overrides.get ?? ((id: string) => (id === "c1" ? okEntry : null)),
    refreshOne: overrides.refreshOne ?? (async () => ({ kind: "ok" as const, entry: okEntry }))
  }
}

function firstText(result: { content: Array<{ type: string; text?: string }> }): string {
  const block = result.content[0]
  if (!block || block.type !== "text" || typeof block.text !== "string") {
    throw new Error("content[0] không phải text block")
  }
  return block.text
}

describe("listQuotas", () => {
  it("chuyển filter xuống quotaService và trả text có tên connection", () => {
    let receivedFilter: unknown = null
    const service = fakeService({
      list: (filter) => {
        receivedFilter = filter
        return { count: 1, lastSweepAt: null, entries: [okEntry] }
      }
    })
    const tools = createMcpTools({ quotaService: service })

    const result = tools.listQuotas({ provider: "kiro", status: "ok" })

    expect(receivedFilter).toEqual({ provider: "kiro", status: "ok" })
    expect(result.isError).toBeUndefined()
    expect(firstText(result)).toContain("kiro")
  })
})

describe("getQuota", () => {
  it("trả text khi tìm thấy", () => {
    const tools = createMcpTools({ quotaService: fakeService() })
    const result = tools.getQuota({ connection_id: "c1" })
    expect(result.isError).toBeUndefined()
    expect(firstText(result)).toContain("c1")
  })

  it("trả isError khi không tìm thấy, gợi ý list_quotas", () => {
    const tools = createMcpTools({ quotaService: fakeService() })
    const result = tools.getQuota({ connection_id: "khong-co" })
    expect(result.isError).toBe(true)
    expect(firstText(result)).toContain("list_quotas")
  })
})

describe("refreshQuota", () => {
  it("gọi refreshOne với force=false luôn luôn", async () => {
    let receivedForce: boolean | null = null
    const service = fakeService({
      refreshOne: async (id, force) => {
        receivedForce = force
        return { kind: "ok" as const, entry: okEntry }
      }
    })
    const tools = createMcpTools({ quotaService: service })

    await tools.refreshQuota({ connection_id: "c1" })

    expect(receivedForce).toBe(false)
  })

  it("trả isError kèm connection_id khi notFound", async () => {
    const service = fakeService({ refreshOne: async () => ({ kind: "notFound" as const }) })
    const tools = createMcpTools({ quotaService: service })

    const result = await tools.refreshQuota({ connection_id: "khong-co" })

    expect(result.isError).toBe(true)
    expect(firstText(result)).toContain("khong-co")
  })

  it("trả isError kèm số giây khi đang cooldown", async () => {
    const service = fakeService({
      refreshOne: async () => ({ kind: "cooldown" as const, retryAfterSeconds: 42 })
    })
    const tools = createMcpTools({ quotaService: service })

    const result = await tools.refreshQuota({ connection_id: "c1" })

    expect(result.isError).toBe(true)
    expect(firstText(result)).toContain("42")
  })

  it("trả text xác nhận thời điểm làm tươi khi ok", async () => {
    const tools = createMcpTools({ quotaService: fakeService() })
    const result = await tools.refreshQuota({ connection_id: "c1" })
    expect(result.isError).toBeUndefined()
    expect(firstText(result)).toContain("2026-08-29T09:00:00.000Z")
  })
})
