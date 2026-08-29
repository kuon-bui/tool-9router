import { describe, expect, it } from "bun:test"
import { isEntryStatus } from "../src/types"

describe("isEntryStatus", () => {
  it("nhận đúng năm giá trị hợp lệ", () => {
    for (const s of ["ok", "unavailable", "unauthorized", "error", "pending"]) {
      expect(isEntryStatus(s)).toBe(true)
    }
  })

  it("từ chối giá trị lạ", () => {
    expect(isEntryStatus("missing")).toBe(false)
    expect(isEntryStatus("")).toBe(false)
  })
})
