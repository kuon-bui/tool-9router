export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ConfigError"
  }
}

export type Config = {
  apiKey: string
  port: number
  host: string
  upstreamUrl: string
  dataDirOverride: string | undefined
  pollIntervalMs: number
  requestDelayMs: number
  refreshCooldownMs: number
  upstreamTimeoutMs: number
  allowRouterApiKeys: boolean
  routerApiKeysCacheTtlMs: number
}

function readPositiveInt(
  env: Record<string, string | undefined>,
  key: string,
  fallback: number
): number {
  const raw = env[key]
  if (raw === undefined || raw.trim() === "") return fallback
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ConfigError(`${key} phải là số nguyên dương, nhận được "${raw}"`)
  }
  return parsed
}

/** PORT=0 hợp lệ: bảo hệ điều hành tự chọn cổng trống — test smoke dùng cách này. */
function readPort(env: Record<string, string | undefined>, fallback: number): number {
  const raw = env.PORT
  if (raw === undefined || raw.trim() === "") return fallback
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535) {
    throw new ConfigError(`PORT phải là số nguyên trong khoảng 0–65535, nhận được "${raw}"`)
  }
  return parsed
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const apiKey = env.API_KEY?.trim()
  if (!apiKey) {
    throw new ConfigError(
      "Thiếu API_KEY. Server bind ra ngoài và nắm CLI token có toàn quyền dashboard 9Router, " +
        "nên bắt buộc phải đặt API_KEY trước khi chạy."
    )
  }

  const upstreamRaw = env.UPSTREAM_URL?.trim() || "http://localhost:20128"

  return {
    apiKey,
    port: readPort(env, 20_129),
    host: env.HOST?.trim() || "0.0.0.0",
    upstreamUrl: upstreamRaw.replace(/\/+$/, ""),
    dataDirOverride: env.DATA_DIR?.trim() || undefined,
    pollIntervalMs: readPositiveInt(env, "POLL_INTERVAL_MS", 300_000),
    requestDelayMs: readPositiveInt(env, "REQUEST_DELAY_MS", 1_500),
    refreshCooldownMs: readPositiveInt(env, "REFRESH_COOLDOWN_MS", 60_000),
    upstreamTimeoutMs: readPositiveInt(env, "UPSTREAM_TIMEOUT_MS", 20_000),
    allowRouterApiKeys: ["true", "1"].includes(env.ALLOW_ROUTER_API_KEYS?.trim() ?? ""),
    routerApiKeysCacheTtlMs: readPositiveInt(env, "ROUTER_API_KEYS_CACHE_TTL_MS", 30_000)
  }
}
