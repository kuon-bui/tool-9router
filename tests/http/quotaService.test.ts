import { beforeEach, describe, expect, it } from "bun:test"
import { createQuotaService, type QuotaService } from "../../src/http/quotaService"
import { loadConfig } from "../../src/config"
import { SnapshotStore } from "../../src/store"
import type { Connection } from "../../src/types"

const kiro: Connection = { id: "c1", provider: "kiro", name: "Kiro #1", authType: "oauth" }
const codex: Connection = { id: "c2", provider: "codex", name: "Codex", authType: "oauth" }

const okResult = {
  kind: "quotas" as const,
  plan: "Kiro Pro",
  quotas: { credit: { used: 1, total: 2, remaining: 1, resetAt: null, unlimited: false } }
}

let clock: number
let store: SnapshotStore
let sweepCalls: number
let refreshOneCalls: Array<{ id: string; force: boolean }>
let refreshOneReturn: any
let service: QuotaService

beforeEach(() => {
  clock = 1_000_000
  sweepCalls = 0
  refreshOneCalls = []
  refreshOneReturn = null
  store = new SnapshotStore({ staleAfterMs: 600_000, now: () => clock })
  store.syncConnections([kiro, codex])
  store.apply(kiro, okResult)

  const config = loadConfig({ API_KEY: "k", REFRESH_COOLDOWN_MS: "60000" })
  const poller = {
    sweep: async () => {
      sweepCalls += 1
    },
    refreshOne: async (id: string, force: boolean) => {
      refreshOneCalls.push({ id, force })
      return refreshOneReturn
    }
  } as any

  service = createQuotaService({ store, poller, config, now: () => clock })
})

describe("list", () => {
  it("trả count, lastSweepAt và entries từ store", () => {
    const result = service.list({})
    expect(result.count).toBe(2)
    expect(result.entries.map((e) => e.connectionId).sort()).toEqual(["c1", "c2"])
  })

  it("lọc theo provider được chuyển thẳng xuống store", () => {
    const result = service.list({ provider: "kiro" })
    expect(result.entries.map((e) => e.connectionId)).toEqual(["c1"])
  })
})

describe("get", () => {
  it("trả entry khi tồn tại", () => {
    expect(service.get("c1")?.connectionId).toBe("c1")
  })

  it("trả null khi không tồn tại", () => {
    expect(service.get("khong-co")).toBeNull()
  })
})

describe("triggerSweep", () => {
  it("trả accepted ngay và có gọi poller.sweep() (không await bên trong)", () => {
    const result = service.triggerSweep()
    expect(result).toEqual({ accepted: true, connections: 2 })
    expect(sweepCalls).toBe(1)
  })
})

describe("refreshOne", () => {
  it("notFound khi connection không có trong store", async () => {
    const outcome = await service.refreshOne("khong-co", false)
    expect(outcome).toEqual({ kind: "notFound" })
    expect(refreshOneCalls.length).toBe(0)
  })

  it("ok khi thành công, chuyển force xuống poller", async () => {
    refreshOneReturn = { connectionId: "c1", status: "ok" }
    const outcome = await service.refreshOne("c1", true)
    expect(outcome).toEqual({ kind: "ok", entry: refreshOneReturn })
    expect(refreshOneCalls).toEqual([{ id: "c1", force: true }])
  })

  it("notFound khi poller.refreshOne trả null", async () => {
    refreshOneReturn = null
    const outcome = await service.refreshOne("c1", false)
    expect(outcome).toEqual({ kind: "notFound" })
  })

  it("cooldown khi gọi lại trong khoảng refreshCooldownMs", async () => {
    refreshOneReturn = { connectionId: "c1", status: "ok" }
    await service.refreshOne("c1", false)

    clock += 1_000
    const outcome = await service.refreshOne("c1", false)
    expect(outcome.kind).toBe("cooldown")
    if (outcome.kind !== "cooldown") throw new Error("unreachable")
    expect(outcome.retryAfterSeconds).toBe(59)
    expect(refreshOneCalls.length).toBe(1) // lần thứ hai không chạm poller
  })

  it("hết cooldown thì gọi lại được", async () => {
    refreshOneReturn = { connectionId: "c1", status: "ok" }
    await service.refreshOne("c1", false)

    clock += 60_001
    const outcome = await service.refreshOne("c1", false)
    expect(outcome.kind).toBe("ok")
    expect(refreshOneCalls.length).toBe(2)
  })

  it("cooldown tính riêng theo từng connection", async () => {
    refreshOneReturn = { connectionId: "c1", status: "ok" }
    await service.refreshOne("c1", false)

    const outcome = await service.refreshOne("c2", false)
    expect(outcome.kind).toBe("ok")
  })
})
