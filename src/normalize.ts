import type {
  AppliedResult,
  Connection,
  QuotaPool,
  StoredEntry,
  UsageResult
} from "./types"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

/**
 * Tên pool khác nhau theo provider (credit, session, weekly, premium_requests,
 * *_freetrial, …) và registry đổi mỗi bản phát hành. Duyệt key, giữ nguyên tên.
 */
export function normalizePools(raw: unknown): Record<string, QuotaPool> {
  if (!isRecord(raw)) return {}

  const pools: Record<string, QuotaPool> = {}
  for (const [name, value] of Object.entries(raw)) {
    if (!isRecord(value)) continue
    pools[name] = {
      used: numberOrNull(value.used),
      total: numberOrNull(value.total),
      remaining: numberOrNull(value.remaining),
      resetAt: stringOrNull(value.resetAt),
      unlimited: value.unlimited === true
    }
  }
  return pools
}

/**
 * 9Router trả 200 cho cả "có quota" lẫn "không hỗ trợ / lỗi mềm". Không được
 * dựa vào HTTP status — phải kiểm tra sự tồn tại của trường `quotas`.
 */
export function classifyUsageResponse(httpStatus: number, body: unknown): UsageResult {
  if (httpStatus === 404) return { kind: "missing" }

  if (httpStatus === 401) {
    const message = isRecord(body) ? stringOrNull(body.error) : null
    return { kind: "unauthorized", message: message ?? "Refresh credential thất bại" }
  }

  if (httpStatus !== 200) {
    const message = isRecord(body) ? stringOrNull(body.error) : null
    return { kind: "error", message: message ?? `9Router trả HTTP ${httpStatus}` }
  }

  if (isRecord(body) && isRecord(body.quotas)) {
    return {
      kind: "quotas",
      plan: isRecord(body) ? stringOrNull(body.plan) : null,
      quotas: normalizePools(body.quotas)
    }
  }

  const message = isRecord(body) ? stringOrNull(body.message) : null
  return { kind: "message", message: message ?? "9Router không trả quota cho connection này" }
}

export function normalizeConnections(body: unknown): Connection[] {
  if (!isRecord(body) || !Array.isArray(body.connections)) return []

  const out: Connection[] = []
  for (const raw of body.connections) {
    if (!isRecord(raw)) continue
    const id = stringOrNull(raw.id)
    const provider = stringOrNull(raw.provider)
    if (!id || !provider) continue
    out.push({
      id,
      provider,
      name: stringOrNull(raw.name),
      authType: stringOrNull(raw.authType)
    })
  }
  return out
}

export function pendingEntry(conn: Connection): StoredEntry {
  return {
    failed: false,
    entry: {
      connectionId: conn.id,
      provider: conn.provider,
      name: conn.name,
      authType: conn.authType,
      status: "pending",
      plan: null,
      quotas: null,
      message: null,
      fetchedAt: null
    }
  }
}

export function applyResult(
  prev: StoredEntry | null,
  conn: Connection,
  result: AppliedResult,
  nowIso: string
): StoredEntry {
  const base = {
    connectionId: conn.id,
    provider: conn.provider,
    name: conn.name,
    authType: conn.authType
  }

  if (result.kind === "quotas") {
    return {
      failed: false,
      entry: {
        ...base,
        status: "ok",
        plan: result.plan,
        quotas: result.quotas,
        message: null,
        fetchedAt: nowIso
      }
    }
  }

  if (result.kind === "message") {
    return {
      failed: false,
      entry: {
        ...base,
        status: "unavailable",
        plan: null,
        quotas: null,
        message: result.message,
        fetchedAt: nowIso
      }
    }
  }

  // unauthorized và error: giữ nguyên số liệu tốt gần nhất để client vẫn có gì hiển thị.
  return {
    failed: true,
    entry: {
      ...base,
      status: result.kind === "unauthorized" ? "unauthorized" : "error",
      plan: prev?.entry.plan ?? null,
      quotas: prev?.entry.quotas ?? null,
      message: result.message,
      fetchedAt: prev?.entry.fetchedAt ?? null
    }
  }
}
