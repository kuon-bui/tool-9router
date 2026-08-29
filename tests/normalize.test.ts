import { describe, expect, it } from "bun:test"
import {
  applyResult,
  classifyUsageResponse,
  normalizeConnections,
  normalizePools,
  pendingEntry
} from "../src/normalize"
import type { Connection, StoredEntry } from "../src/types"

const conn: Connection = {
  id: "c1",
  provider: "kiro",
  name: "Kiro #1",
  authType: "oauth"
}

const NOW = "2026-08-28T10:15:03.000Z"

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

describe("pendingEntry", () => {
  it("tạo entry pending chưa có dữ liệu", () => {
    const stored = pendingEntry(conn)
    expect(stored.failed).toBe(false)
    expect(stored.entry.status).toBe("pending")
    expect(stored.entry.quotas).toBeNull()
    expect(stored.entry.fetchedAt).toBeNull()
  })
})

describe("applyResult", () => {
  it("kind quotas -> status ok, failed false", () => {
    const stored = applyResult(null, conn, {
      kind: "quotas",
      plan: "Kiro Pro",
      quotas: { credit: { used: 1, total: 2, remaining: 1, resetAt: null, unlimited: false } }
    }, NOW)
    expect(stored.entry.status).toBe("ok")
    expect(stored.entry.plan).toBe("Kiro Pro")
    expect(stored.entry.fetchedAt).toBe(NOW)
    expect(stored.failed).toBe(false)
  })

  it("kind message -> status unavailable, quotas null, giữ message", () => {
    const stored = applyResult(null, conn, {
      kind: "message",
      message: "Usage not available for this connection"
    }, NOW)
    expect(stored.entry.status).toBe("unavailable")
    expect(stored.entry.quotas).toBeNull()
    expect(stored.entry.message).toBe("Usage not available for this connection")
    expect(stored.failed).toBe(false)
  })

  it("kind unauthorized -> status unauthorized, failed true", () => {
    const stored = applyResult(null, conn, { kind: "unauthorized", message: "no" }, NOW)
    expect(stored.entry.status).toBe("unauthorized")
    expect(stored.failed).toBe(true)
  })

  it("kind error giữ nguyên quotas lấy được lần cuối", () => {
    const good = applyResult(null, conn, {
      kind: "quotas",
      plan: "Kiro Pro",
      quotas: { credit: { used: 1, total: 2, remaining: 1, resetAt: null, unlimited: false } }
    }, NOW)

    const later = "2026-08-28T10:20:03.000Z"
    const bad = applyResult(good, conn, { kind: "error", message: "boom" }, later)

    expect(bad.entry.status).toBe("error")
    expect(bad.entry.quotas).toEqual(good.entry.quotas)
    expect(bad.entry.plan).toBe("Kiro Pro")
    expect(bad.entry.message).toBe("boom")
    expect(bad.failed).toBe(true)
    // fetchedAt vẫn là lúc lấy được dữ liệu tốt, không phải lúc lỗi
    expect(bad.entry.fetchedAt).toBe(NOW)
  })

  it("kind error khi chưa từng có dữ liệu tốt thì quotas vẫn null", () => {
    const stored = applyResult(null, conn, { kind: "error", message: "boom" }, NOW)
    expect(stored.entry.quotas).toBeNull()
    expect(stored.entry.fetchedAt).toBeNull()
  })

  it("cập nhật metadata connection mỗi lần apply", () => {
    const prev: StoredEntry = pendingEntry(conn)
    const renamed: Connection = { ...conn, name: "Kiro renamed" }
    const stored = applyResult(prev, renamed, { kind: "message", message: "m" }, NOW)
    expect(stored.entry.name).toBe("Kiro renamed")
  })
})
