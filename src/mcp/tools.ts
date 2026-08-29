import { z } from "zod"
import type { CallToolResult } from "@modelcontextprotocol/server"
import { ENTRY_STATUSES } from "../types"
import type { EntryStatus, QuotaEntry } from "../types"
import { formatQuotaList, formatRefreshedEntry, formatSingleEntry } from "./format"

export type McpToolsDeps = {
  quotaService: {
    list(filter: { provider?: string | undefined; status?: EntryStatus | undefined }): {
      count: number
      lastSweepAt: string | null
      entries: QuotaEntry[]
    }
    get(id: string): QuotaEntry | null
    refreshOne(
      id: string,
      force: boolean
    ): Promise<
      | { kind: "ok"; entry: QuotaEntry }
      | { kind: "notFound" }
      | { kind: "cooldown"; retryAfterSeconds: number }
    >
  }
}

export const listQuotasInputSchema = z.object({
  provider: z.string().optional(),
  status: z.enum(ENTRY_STATUSES).optional()
})

export const getQuotaInputSchema = z.object({
  connection_id: z.string().min(1)
})

export const refreshQuotaInputSchema = z.object({
  connection_id: z.string().min(1)
})

function textResult(text: string, isError = false): CallToolResult {
  return isError ? { content: [{ type: "text", text }], isError: true } : { content: [{ type: "text", text }] }
}

function notFoundResult(connectionId: string): CallToolResult {
  return textResult(
    `Không có connection nào với id "${connectionId}". Gọi list_quotas để xem danh sách hợp lệ.`,
    true
  )
}

export function createMcpTools(deps: McpToolsDeps) {
  const { quotaService } = deps

  return {
    listQuotas(input: z.infer<typeof listQuotasInputSchema>): CallToolResult {
      const result = quotaService.list({ provider: input.provider, status: input.status })
      const text = formatQuotaList(result.entries, {
        lastSweepAt: result.lastSweepAt,
        filter: { provider: input.provider, status: input.status }
      })
      return textResult(text)
    },

    getQuota(input: z.infer<typeof getQuotaInputSchema>): CallToolResult {
      const entry = quotaService.get(input.connection_id)
      if (!entry) return notFoundResult(input.connection_id)
      return textResult(formatSingleEntry(entry))
    },

    async refreshQuota(input: z.infer<typeof refreshQuotaInputSchema>): Promise<CallToolResult> {
      const outcome = await quotaService.refreshOne(input.connection_id, false)

      switch (outcome.kind) {
        case "notFound":
          return notFoundResult(input.connection_id)
        case "cooldown":
          return textResult(
            `Connection này vừa được làm tươi gần đây. Thử lại sau ${outcome.retryAfterSeconds} giây — đừng gọi lại ngay.`,
            true
          )
        case "ok":
          return textResult(formatRefreshedEntry(outcome.entry))
      }
    }
  }
}

export type McpTools = ReturnType<typeof createMcpTools>
