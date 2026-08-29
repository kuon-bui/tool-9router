import type { AppliedResult, Connection, StoredEntry } from "../types"

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
