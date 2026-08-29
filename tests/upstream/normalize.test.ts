import { describe, expect, it } from "bun:test"
import {
  classifyUsageResponse,
  normalizeApiKeys,
  normalizeConnections,
  normalizePools
} from "../../src/upstream"

describe("normalizePools", () => {
  it("giữ nguyên tên pool chưa từng thấy", () => {
    const pools = normalizePools({
      some_brand_new_pool: { used: 1, total: 2, remaining: 1, unlimited: false }
    })
    expect(Object.keys(pools)).toEqual(["some_brand_new_pool"])
  })

  it("điền null cho trường thiếu và false cho unlimited", () => {
    const pools = normalizePools({ credit: {} })
    expect(pools.credit).toEqual({
      used: null,
      total: null,
      remaining: null,
      resetAt: null,
      unlimited: false
    })
  })

  it("giữ nguyên số và resetAt", () => {
    const pools = normalizePools({
      credit: {
        used: 12.5,
        total: 50,
        remaining: 37.5,
        resetAt: "2026-09-01T00:00:00.000Z",
        unlimited: false
      }
    })
    expect(pools.credit).toEqual({
      used: 12.5,
      total: 50,
      remaining: 37.5,
      resetAt: "2026-09-01T00:00:00.000Z",
      unlimited: false
    })
  })

  it("bỏ qua giá trị pool không phải object", () => {
    const pools = normalizePools({ credit: "nonsense", weekly: { used: 1 } })
    expect(Object.keys(pools)).toEqual(["weekly"])
  })

  it("trả object rỗng khi input không phải object", () => {
    expect(normalizePools(null)).toEqual({})
    expect(normalizePools("x")).toEqual({})
  })
})

describe("classifyUsageResponse", () => {
  it("200 có quotas -> kind quotas", () => {
    const result = classifyUsageResponse(200, {
      plan: "Kiro Pro",
      quotas: { credit: { used: 1, total: 2 } }
    })
    expect(result.kind).toBe("quotas")
    if (result.kind !== "quotas") throw new Error("unreachable")
    expect(result.plan).toBe("Kiro Pro")
    expect(result.quotas.credit?.used).toBe(1)
  })

  it("200 có message -> kind message", () => {
    const result = classifyUsageResponse(200, {
      message: "Usage not available for this connection"
    })
    expect(result).toEqual({
      kind: "message",
      message: "Usage not available for this connection"
    })
  })

  it("200 quotas rỗng vẫn là kind quotas", () => {
    const result = classifyUsageResponse(200, { quotas: {} })
    expect(result.kind).toBe("quotas")
  })

  it("200 không quotas không message -> kind message với mô tả mặc định", () => {
    const result = classifyUsageResponse(200, {})
    expect(result.kind).toBe("message")
  })

  it("401 -> kind unauthorized", () => {
    expect(classifyUsageResponse(401, { error: "Unauthorized" }).kind).toBe("unauthorized")
  })

  it("404 -> kind missing", () => {
    expect(classifyUsageResponse(404, {})).toEqual({ kind: "missing" })
  })

  it("500 -> kind error", () => {
    expect(classifyUsageResponse(500, {}).kind).toBe("error")
  })

  it("429 -> kind error", () => {
    expect(classifyUsageResponse(429, {}).kind).toBe("error")
  })
})

describe("normalizeConnections", () => {
  it("đọc mảng connections và điền null cho trường thiếu", () => {
    const conns = normalizeConnections({
      connections: [{ id: "c1", provider: "kiro" }]
    })
    expect(conns).toEqual([{ id: "c1", provider: "kiro", name: null, authType: null }])
  })

  it("bỏ qua phần tử thiếu id hoặc provider", () => {
    const conns = normalizeConnections({
      connections: [{ id: "c1" }, { provider: "kiro" }, { id: "c2", provider: "codex" }]
    })
    expect(conns.map((c) => c.id)).toEqual(["c2"])
  })

  it("trả mảng rỗng khi shape lạ", () => {
    expect(normalizeConnections({})).toEqual([])
    expect(normalizeConnections(null)).toEqual([])
  })
})

describe("normalizeApiKeys", () => {
  it("đọc mảng keys, chỉ giữ key và isActive", () => {
    const keys = normalizeApiKeys({
      keys: [
        {
          id: "ecd9bd16-20eb-4430-abcb-14d1bdf183e8",
          key: "sk-4abb1f93d313c5b0-yan8m4-54291fe7",
          name: "Default Key",
          machineId: "4abb1f93d313c5b0",
          isActive: true,
          createdAt: "2026-08-29T03:55:57.915Z"
        }
      ]
    })
    expect(keys).toEqual([{ key: "sk-4abb1f93d313c5b0-yan8m4-54291fe7", isActive: true }])
  })

  it("bỏ qua phần tử thiếu key hoặc isActive không phải boolean", () => {
    const keys = normalizeApiKeys({
      keys: [{ key: "k1" }, { isActive: true }, { key: "k2", isActive: false }]
    })
    expect(keys).toEqual([{ key: "k2", isActive: false }])
  })

  it("trả mảng rỗng khi shape lạ", () => {
    expect(normalizeApiKeys({})).toEqual([])
    expect(normalizeApiKeys(null)).toEqual([])
  })
})
