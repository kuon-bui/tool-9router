import { Elysia } from "elysia"
import { isEntryStatus } from "../types"
import { createGuards, type GuardDeps } from "../guards"
import type { QuotaService } from "./quotaService"
import { errorSchema, quotaEntrySchema, quotaListSchema } from "./schemas"

export type QuotasDeps = GuardDeps & {
  quotaService: Pick<QuotaService, "get" | "list">
}

export function createQuotasRoutes(deps: QuotasDeps) {
  const { quotaService } = deps

  return new Elysia()
    .use(createGuards(deps))
    .get(
      "/quotas",
      ({ query, status }) => {
        const wanted = query.status
        if (wanted !== undefined && !isEntryStatus(wanted)) {
          return status(400, { error: `status không hợp lệ: ${wanted}` })
        }
        return quotaService.list({ provider: query.provider, status: wanted })
      },
      {
        apiKey: true,
        needsToken: true,
        response: { 200: quotaListSchema, 400: errorSchema, 401: errorSchema, 503: errorSchema }
      }
    )
    .get(
      "/quotas/:id",
      ({ params, status }) => {
        const entry = quotaService.get(params.id)
        if (!entry) return status(404, { error: `Không có connection ${params.id}` })
        return entry
      },
      {
        apiKey: true,
        needsToken: true,
        response: { 200: quotaEntrySchema, 401: errorSchema, 404: errorSchema, 503: errorSchema }
      }
    )
}
