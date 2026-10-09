import { describe, expect, it } from "bun:test"
import { ConfigError, loadConfig } from "../src/config"

const base = { API_KEY: "k" }

describe("loadConfig", () => {
  it("điền đủ mặc định khi chỉ có API_KEY", () => {
    const cfg = loadConfig(base)
    expect(cfg.apiKey).toBe("k")
    expect(cfg.port).toBe(20129)
    expect(cfg.host).toBe("0.0.0.0")
    expect(cfg.upstreamUrl).toBe("http://localhost:20128")
    expect(cfg.pollIntervalMs).toBe(300_000)
    expect(cfg.requestDelayMs).toBe(1_500)
    expect(cfg.refreshCooldownMs).toBe(60_000)
    expect(cfg.upstreamTimeoutMs).toBe(20_000)
    expect(cfg.reconnectIntervalMs).toBe(5_000)
  })

  it("ném ConfigError khi thiếu API_KEY", () => {
    expect(() => loadConfig({})).toThrow(ConfigError)
  })

  it("ném ConfigError khi API_KEY rỗng hoặc chỉ có khoảng trắng", () => {
    expect(() => loadConfig({ API_KEY: "   " })).toThrow(ConfigError)
  })

  it("đọc giá trị số từ env", () => {
    const cfg = loadConfig({ ...base, PORT: "31000", POLL_INTERVAL_MS: "60000", RECONNECT_INTERVAL_MS: "3000" })
    expect(cfg.port).toBe(31_000)
    expect(cfg.pollIntervalMs).toBe(60_000)
    expect(cfg.reconnectIntervalMs).toBe(3_000)
  })

  it("ném ConfigError khi số không hợp lệ", () => {
    expect(() => loadConfig({ ...base, PORT: "abc" })).toThrow(ConfigError)
    expect(() => loadConfig({ ...base, POLL_INTERVAL_MS: "-5" })).toThrow(ConfigError)
    expect(() => loadConfig({ ...base, POLL_INTERVAL_MS: "0" })).toThrow(ConfigError)
  })

  it("cho phép PORT=0 để hệ điều hành tự chọn cổng", () => {
    expect(loadConfig({ ...base, PORT: "0" }).port).toBe(0)
  })

  it("ném ConfigError khi PORT ngoài dải hợp lệ", () => {
    expect(() => loadConfig({ ...base, PORT: "70000" })).toThrow(ConfigError)
    expect(() => loadConfig({ ...base, PORT: "-1" })).toThrow(ConfigError)
  })

  it("cắt dấu / thừa ở cuối upstreamUrl", () => {
    const cfg = loadConfig({ ...base, UPSTREAM_URL: "http://localhost:20128/" })
    expect(cfg.upstreamUrl).toBe("http://localhost:20128")
  })

  it("giữ nguyên DATA_DIR khi được đặt", () => {
    const cfg = loadConfig({ ...base, DATA_DIR: "C:\\data\\9router" })
    expect(cfg.dataDirOverride).toBe("C:\\data\\9router")
  })

  it("allowRouterApiKeys mặc định false, ttl mặc định 30000", () => {
    const cfg = loadConfig(base)
    expect(cfg.allowRouterApiKeys).toBe(false)
    expect(cfg.routerApiKeysCacheTtlMs).toBe(30_000)
  })

  it("bật allowRouterApiKeys khi ALLOW_ROUTER_API_KEYS=true", () => {
    expect(loadConfig({ ...base, ALLOW_ROUTER_API_KEYS: "true" }).allowRouterApiKeys).toBe(true)
    expect(loadConfig({ ...base, ALLOW_ROUTER_API_KEYS: "1" }).allowRouterApiKeys).toBe(true)
  })

  it("giữ allowRouterApiKeys false với giá trị khác true/1", () => {
    expect(loadConfig({ ...base, ALLOW_ROUTER_API_KEYS: "false" }).allowRouterApiKeys).toBe(false)
    expect(loadConfig({ ...base, ALLOW_ROUTER_API_KEYS: "no" }).allowRouterApiKeys).toBe(false)
  })

  it("đọc ROUTER_API_KEYS_CACHE_TTL_MS từ env", () => {
    expect(
      loadConfig({ ...base, ROUTER_API_KEYS_CACHE_TTL_MS: "5000" }).routerApiKeysCacheTtlMs
    ).toBe(5_000)
  })

  it("ném ConfigError khi ROUTER_API_KEYS_CACHE_TTL_MS không hợp lệ", () => {
    expect(() => loadConfig({ ...base, ROUTER_API_KEYS_CACHE_TTL_MS: "abc" })).toThrow(ConfigError)
    expect(() => loadConfig({ ...base, ROUTER_API_KEYS_CACHE_TTL_MS: "0" })).toThrow(ConfigError)
  })
})
