import { describe, expect, it } from "bun:test"
import { applyResult, pendingEntry } from "../../src/store"
import type { Connection, StoredEntry } from "../../src/types"

const conn: Connection = {
  id: "c1",
  provider: "kiro",
  name: "Kiro #1",
  authType: "oauth"
}

const NOW = "2026-08-28T10:15:03.000Z"

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
