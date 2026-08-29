export type QuotaPool = {
  used: number | null
  total: number | null
  remaining: number | null
  resetAt: string | null
  unlimited: boolean
}

export const ENTRY_STATUSES = [
  "ok",
  "unavailable",
  "unauthorized",
  "error",
  "pending"
] as const

export type EntryStatus = (typeof ENTRY_STATUSES)[number]

export function isEntryStatus(value: unknown): value is EntryStatus {
  return typeof value === "string" && (ENTRY_STATUSES as readonly string[]).includes(value)
}

export type QuotaEntry = {
  connectionId: string
  provider: string
  name: string | null
  authType: string | null
  status: EntryStatus
  plan: string | null
  quotas: Record<string, QuotaPool> | null
  message: string | null
  fetchedAt: string | null
  stale: boolean
}

/** Entry như store giữ bên trong: chưa tính `stale`. */
export type StoredEntry = {
  entry: Omit<QuotaEntry, "stale">
  failed: boolean
}

export type Connection = {
  id: string
  provider: string
  name: string | null
  authType: string | null
}

export type UsageResult =
  | { kind: "quotas"; plan: string | null; quotas: Record<string, QuotaPool> }
  | { kind: "message"; message: string }
  | { kind: "unauthorized"; message: string }
  | { kind: "missing" }
  | { kind: "error"; message: string }

/** `missing` được xử lý bằng cách gỡ khỏi store, không đi qua applyResult. */
export type AppliedResult = Exclude<UsageResult, { kind: "missing" }>
