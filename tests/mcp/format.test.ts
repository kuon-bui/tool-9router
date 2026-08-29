import { describe, expect, it } from "bun:test"
import { formatQuotaList, formatRefreshedEntry, formatSingleEntry } from "../../src/mcp/format"
import type { QuotaEntry } from "../../src/types"

function entry(overrides: Partial<QuotaEntry> = {}): QuotaEntry {
  return {
    connectionId: "c1",
    provider: "kiro",
    name: "Kiro #1",
    authType: "oauth",
    status: "ok",
    plan: "Kiro Pro",
    quotas: {
      credit: { used: 25, total: 100, remaining: 75, resetAt: "2026-09-01T00:00:00.000Z", unlimited: false }
    },
    message: null,
    fetchedAt: "2026-08-29T09:00:00.000Z",
    stale: false,
    ...overrides
  }
}

describe("formatSingleEntry", () => {
  it("in tên provider, tên connection, id và trạng thái", () => {
    const text = formatSingleEntry(entry())
    expect(text).toContain("kiro")
    expect(text).toContain("Kiro #1")
    expect(text).toContain("c1")
    expect(text).toContain("ok")
  })

  it("in thanh tiến trình và phần trăm đã dùng, không phải còn lại", () => {
    const text = formatSingleEntry(entry())
    expect(text).toContain("25%")
    expect(text).toContain("25 / 100")
    expect(text).toContain("còn 75")
  })

  it("unlimited: true in vô cực, không in thanh hay %", () => {
    const text = formatSingleEntry(
      entry({ quotas: { credit: { used: 5, total: null, remaining: null, resetAt: null, unlimited: true } } })
    )
    expect(text).toContain("∞")
    expect(text).not.toContain("%")
  })

  it("total là null: bỏ thanh và %, vẫn in used nếu có", () => {
    const text = formatSingleEntry(
      entry({ quotas: { session: { used: 10, total: null, remaining: null, resetAt: null, unlimited: false } } })
    )
    expect(text).not.toContain("%")
    expect(text).not.toContain("█")
    expect(text).toContain("10")
  })

  it("total là 0: bỏ thanh và %", () => {
    const text = formatSingleEntry(
      entry({ quotas: { weekly: { used: 0, total: 0, remaining: 0, resetAt: null, unlimited: false } } })
    )
    expect(text).not.toContain("%")
    expect(text).not.toContain("█")
  })

  it("used là null: bỏ thanh và %, vẫn in total/remaining nếu có", () => {
    const text = formatSingleEntry(
      entry({ quotas: { credit: { used: null, total: 50, remaining: 50, resetAt: null, unlimited: false } } })
    )
    expect(text).not.toContain("%")
    expect(text).toContain("còn 50")
  })

  it("stale: true thêm nhãn số liệu cũ", () => {
    const text = formatSingleEntry(entry({ stale: true }))
    expect(text).toContain("số liệu cũ")
  })

  it("stale: false không thêm nhãn", () => {
    const text = formatSingleEntry(entry({ stale: false }))
    expect(text).not.toContain("số liệu cũ")
  })

  it("status khác ok: in message, không in bảng pool", () => {
    const text = formatSingleEntry(
      entry({ status: "unauthorized", quotas: null, message: "Cần authorize lại." })
    )
    expect(text).toContain("Cần authorize lại.")
    expect(text).not.toContain("█")
  })

  it("quotas là object rỗng: in message thay vì bảng trống", () => {
    const text = formatSingleEntry(entry({ quotas: {}, message: "Không có số liệu." }))
    expect(text).toContain("Không có số liệu.")
  })

  it("pool không có field nào có giá trị: không in dòng trống", () => {
    const text = formatSingleEntry(
      entry({ quotas: { odd: { used: null, total: null, remaining: null, resetAt: null, unlimited: false } } })
    )
    expect(text.trim().length).toBeGreaterThan(0)
    expect(text).toContain("odd")
  })
})

describe("formatQuotaList", () => {
  it("in số lượng connection và thời điểm snapshot", () => {
    const text = formatQuotaList([entry()], { lastSweepAt: "2026-08-29T09:00:00.000Z" })
    expect(text).toContain("1 connection")
    expect(text).toContain("2026-08-29T09:00:00.000Z")
  })

  it("danh sách rỗng không do lọc: nêu chưa có gì, không nhắc bộ lọc", () => {
    const text = formatQuotaList([], { lastSweepAt: null })
    expect(text.toLowerCase()).toContain("không có")
  })

  it("danh sách rỗng do lọc: nêu rõ đã lọc theo gì", () => {
    const text = formatQuotaList([], { lastSweepAt: "x", filter: { provider: "codex" } })
    expect(text).toContain("provider=codex")
  })
})

describe("formatRefreshedEntry", () => {
  it("thêm dòng xác nhận thời điểm làm tươi trước nội dung entry", () => {
    const text = formatRefreshedEntry(entry())
    expect(text).toContain("Vừa làm tươi")
    expect(text).toContain("2026-08-29T09:00:00.000Z")
    expect(text).toContain("kiro")
  })
})
