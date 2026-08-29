import type { EntryStatus, QuotaEntry, QuotaPool } from "../types"

const STATUS_ICON: Record<EntryStatus, string> = {
  ok: "✅",
  unavailable: "➖",
  unauthorized: "⛔",
  error: "❌",
  pending: "⏱"
}

const BAR_WIDTH = 16

function formatPool(name: string, pool: QuotaPool): string {
  if (pool.unlimited) {
    return `\`${name}\`  ∞`
  }

  const parts: string[] = []

  if (pool.used !== null && pool.total !== null && pool.total > 0) {
    const fraction = pool.used / pool.total
    const filled = Math.min(BAR_WIDTH, Math.max(0, Math.floor(fraction * BAR_WIDTH)))
    const bar = "█".repeat(filled) + "░".repeat(BAR_WIDTH - filled)
    const percent = Math.round(fraction * 100)
    parts.push(`${bar}  ${percent}%`)
  }

  if (pool.used !== null && pool.total !== null) {
    parts.push(`${pool.used} / ${pool.total}`)
  } else if (pool.used !== null) {
    parts.push(`đã dùng ${pool.used}`)
  } else if (pool.total !== null) {
    parts.push(`tổng ${pool.total}`)
  }

  if (pool.remaining !== null) {
    parts.push(`còn ${pool.remaining}`)
  }

  if (pool.resetAt !== null) {
    parts.push(`reset \`${pool.resetAt}\``)
  }

  // Phòng trường hợp cả bốn field đều null và không unlimited — chưa từng thấy
  // thực tế, nhưng đừng để lọt ra một dòng trống không nói gì.
  if (parts.length === 0) return `\`${name}\`  (không có số liệu)`

  return `\`${name}\`  ${parts.join("  ·  ")}`
}

function formatEntry(entry: QuotaEntry): string {
  const icon = STATUS_ICON[entry.status]
  const staleTag = entry.stale ? "  ⏳ số liệu cũ" : ""
  const header =
    `### ${entry.provider} · ${entry.name ?? entry.connectionId} \`${entry.connectionId}\`` +
    `  ${icon} ${entry.status}${staleTag}`

  if (entry.status !== "ok" || !entry.quotas || Object.keys(entry.quotas).length === 0) {
    const message = entry.message ?? "Không có số liệu quota cho connection này."
    return `${header}\n${message}`
  }

  const pools = Object.entries(entry.quotas).map(([name, pool]) => formatPool(name, pool))
  return `${header}\n${pools.join("\n")}`
}

export type QuotaListMeta = {
  lastSweepAt: string | null
  filter?: { provider?: string | undefined; status?: string | undefined }
}

export function formatQuotaList(entries: QuotaEntry[], meta: QuotaListMeta): string {
  if (entries.length === 0) {
    const filters: string[] = []
    if (meta.filter?.provider) filters.push(`provider=${meta.filter.provider}`)
    if (meta.filter?.status) filters.push(`status=${meta.filter.status}`)
    const filterText = filters.length > 0 ? ` (đã lọc theo ${filters.join(", ")})` : ""
    return `Không có connection nào khớp${filterText}. Thử bỏ bộ lọc hoặc kiểm tra lại 9Router.`
  }

  const sweepText = meta.lastSweepAt
    ? `snapshot lúc \`${meta.lastSweepAt}\``
    : "chưa có vòng quét nào hoàn tất"
  const header = `**${entries.length} connection** · ${sweepText}`

  return [header, ...entries.map(formatEntry)].join("\n\n")
}

export function formatSingleEntry(entry: QuotaEntry): string {
  return formatEntry(entry)
}

export function formatRefreshedEntry(entry: QuotaEntry): string {
  const when = entry.fetchedAt ? `\`${entry.fetchedAt}\`` : "không rõ thời điểm"
  return `Vừa làm tươi lúc ${when}.\n\n${formatEntry(entry)}`
}
