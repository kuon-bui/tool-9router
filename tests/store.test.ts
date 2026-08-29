import { beforeEach, describe, expect, it } from "bun:test"
import { SnapshotStore } from "../src/store"
import type { Connection } from "../src/types"

const kiro: Connection = { id: "c1", provider: "kiro", name: "Kiro #1", authType: "oauth" }
const codex: Connection = { id: "c2", provider: "codex", name: "Codex", authType: "oauth" }

const okResult = {
  kind: "quotas" as const,
  plan: "Kiro Pro",
  quotas: { credit: { used: 1, total: 2, remaining: 1, resetAt: null, unlimited: false } }
}

let clock = 1_000_000
let store: SnapshotStore

beforeEach(() => {
  clock = 1_000_000
  store = new SnapshotStore({ staleAfterMs: 600_000, now: () => clock })
})

describe("syncConnections", () => {
  it("thêm connection mới ở trạng thái pending", () => {
    store.syncConnections([kiro])
    expect(store.get("c1")?.status).toBe("pending")
    expect(store.size()).toBe(1)
  })

  it("gỡ connection không còn trong danh sách", () => {
    store.syncConnections([kiro, codex])
    store.syncConnections([kiro])
    expect(store.get("c2")).toBeNull()
    expect(store.size()).toBe(1)
  })

  it("không xoá dữ liệu quota của connection còn tồn tại", () => {
    store.syncConnections([kiro])
    store.apply(kiro, okResult)
    store.syncConnections([kiro])
    expect(store.get("c1")?.status).toBe("ok")
  })

  it("cập nhật tên khi connection được đổi tên", () => {
    store.syncConnections([kiro])
    store.apply(kiro, okResult)
    store.syncConnections([{ ...kiro, name: "Đổi tên" }])
    expect(store.get("c1")?.name).toBe("Đổi tên")
  })
})

describe("stale", () => {
  it("false ngay sau khi lấy thành công", () => {
    store.syncConnections([kiro])
    store.apply(kiro, okResult)
    expect(store.get("c1")?.stale).toBe(false)
  })

  it("true khi dữ liệu cũ hơn staleAfterMs", () => {
    store.syncConnections([kiro])
    store.apply(kiro, okResult)
    clock += 600_001
    expect(store.get("c1")?.stale).toBe(true)
  })

  it("true ngay lập tức khi lượt lấy gần nhất thất bại", () => {
    store.syncConnections([kiro])
    store.apply(kiro, okResult)
    store.apply(kiro, { kind: "error", message: "boom" })
    expect(store.get("c1")?.stale).toBe(true)
  })

  it("false với entry pending vì chưa có dữ liệu nào để mà cũ", () => {
    store.syncConnections([kiro])
    clock += 10_000_000
    expect(store.get("c1")?.stale).toBe(false)
  })
})

describe("list", () => {
  beforeEach(() => {
    store.syncConnections([kiro, codex])
    store.apply(kiro, okResult)
    store.apply(codex, { kind: "message", message: "không hỗ trợ" })
  })

  it("trả tất cả khi không lọc", () => {
    expect(store.list().map((e) => e.connectionId).sort()).toEqual(["c1", "c2"])
  })

  it("lọc theo provider", () => {
    expect(store.list({ provider: "kiro" }).map((e) => e.connectionId)).toEqual(["c1"])
  })

  it("lọc theo status", () => {
    expect(store.list({ status: "unavailable" }).map((e) => e.connectionId)).toEqual(["c2"])
  })

  it("lọc kết hợp không khớp thì trả rỗng", () => {
    expect(store.list({ provider: "kiro", status: "unavailable" })).toEqual([])
  })
})

describe("markSweep", () => {
  it("lastSweepAt null trước lần quét đầu", () => {
    expect(store.lastSweepAt()).toBeNull()
  })

  it("ghi lại thời điểm quét gần nhất dạng ISO", () => {
    store.markSweep()
    expect(store.lastSweepAt()).toBe(new Date(clock).toISOString())
  })
})

describe("apply với connection chưa có trong store", () => {
  it("tự thêm entry", () => {
    store.apply(kiro, okResult)
    expect(store.get("c1")?.status).toBe("ok")
  })
})

describe("remove", () => {
  it("gỡ hẳn entry", () => {
    store.syncConnections([kiro])
    store.remove("c1")
    expect(store.get("c1")).toBeNull()
  })
})

describe("markAllStale", () => {
  it("đánh dấu mọi entry là stale dù chưa cũ theo tuổi", () => {
    store.syncConnections([kiro])
    store.apply(kiro, okResult)
    expect(store.get("c1")?.stale).toBe(false)

    store.markAllStale()

    expect(store.get("c1")?.stale).toBe(true)
  })

  it("giữ nguyên số liệu quota, chỉ đổi cờ stale", () => {
    store.syncConnections([kiro])
    store.apply(kiro, okResult)
    store.markAllStale()

    expect(store.get("c1")?.quotas).toEqual(okResult.quotas)
    expect(store.get("c1")?.status).toBe("ok")
  })

  it("không ảnh hưởng gì khi store rỗng", () => {
    expect(() => store.markAllStale()).not.toThrow()
  })
})
