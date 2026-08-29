import { describe, expect, it } from "bun:test"
import { createRouterKeyCache } from "../../src/guards/routerKeyCache"
import type { RouterApiKey } from "../../src/types"

function fakeUpstream(keys: RouterApiKey[]) {
  let calls = 0
  return {
    calls: () => calls,
    listApiKeys: async () => {
      calls++
      return keys
    }
  }
}

describe("createRouterKeyCache", () => {
  it("hợp lệ khi key khớp và isActive true", async () => {
    const upstream = fakeUpstream([{ key: "sk-abc", isActive: true }])
    const cache = createRouterKeyCache({ upstream, ttlMs: 30_000, now: () => 0 })
    expect(await cache.isValid("sk-abc")).toBe(true)
  })

  it("không hợp lệ khi key không khớp", async () => {
    const upstream = fakeUpstream([{ key: "sk-abc", isActive: true }])
    const cache = createRouterKeyCache({ upstream, ttlMs: 30_000, now: () => 0 })
    expect(await cache.isValid("sk-khac")).toBe(false)
  })

  it("không hợp lệ khi key khớp nhưng isActive false", async () => {
    const upstream = fakeUpstream([{ key: "sk-abc", isActive: false }])
    const cache = createRouterKeyCache({ upstream, ttlMs: 30_000, now: () => 0 })
    expect(await cache.isValid("sk-abc")).toBe(false)
  })

  it("dùng cache trong TTL, không gọi lại upstream", async () => {
    const upstream = fakeUpstream([{ key: "sk-abc", isActive: true }])
    let clock = 0
    const cache = createRouterKeyCache({ upstream, ttlMs: 30_000, now: () => clock })
    await cache.isValid("sk-abc")
    clock = 29_999
    await cache.isValid("sk-abc")
    expect(upstream.calls()).toBe(1)
  })

  it("gọi lại upstream sau khi hết TTL", async () => {
    const upstream = fakeUpstream([{ key: "sk-abc", isActive: true }])
    let clock = 0
    const cache = createRouterKeyCache({ upstream, ttlMs: 30_000, now: () => clock })
    await cache.isValid("sk-abc")
    clock = 30_001
    await cache.isValid("sk-abc")
    expect(upstream.calls()).toBe(2)
  })

  it("gộp các lệnh gọi đồng thời thành một lần fetch upstream", async () => {
    const upstream = fakeUpstream([{ key: "sk-abc", isActive: true }])
    const cache = createRouterKeyCache({ upstream, ttlMs: 30_000, now: () => 0 })
    await Promise.all([cache.isValid("sk-abc"), cache.isValid("sk-abc"), cache.isValid("sk-abc")])
    expect(upstream.calls()).toBe(1)
  })

  it("ném lỗi khi upstream lỗi và chưa có cache", async () => {
    const upstream = { listApiKeys: async () => { throw new Error("boom") } }
    const cache = createRouterKeyCache({ upstream, ttlMs: 30_000, now: () => 0 })
    await expect(cache.isValid("sk-abc")).rejects.toThrow("boom")
  })

  it("ném lỗi khi upstream lỗi lúc refetch sau TTL, không dùng cache cũ", async () => {
    let clock = 0
    let fail = false
    const upstream = {
      listApiKeys: async () => {
        if (fail) throw new Error("boom")
        return [{ key: "sk-abc", isActive: true }]
      }
    }
    const cache = createRouterKeyCache({ upstream, ttlMs: 30_000, now: () => clock })
    expect(await cache.isValid("sk-abc")).toBe(true)
    clock = 30_001
    fail = true
    await expect(cache.isValid("sk-abc")).rejects.toThrow("boom")
  })
})
