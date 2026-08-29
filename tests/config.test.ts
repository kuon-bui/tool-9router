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
  })

  it("ném ConfigError khi thiếu API_KEY", () => {
    expect(() => loadConfig({})).toThrow(ConfigError)
  })

  it("ném ConfigError khi API_KEY rỗng hoặc chỉ có khoảng trắng", () => {
    expect(() => loadConfig({ API_KEY: "   " })).toThrow(ConfigError)
  })

  it("đọc giá trị số từ env", () => {
    const cfg = loadConfig({ ...base, PORT: "31000", POLL_INTERVAL_MS: "60000" })
    expect(cfg.port).toBe(31_000)
    expect(cfg.pollIntervalMs).toBe(60_000)
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
    const cfg = loadConfig({ ...base, DATA_DIR: "C:\data\9router" })
    expect(cfg.dataDirOverride).toBe("C:\data\9router")
  })
})
