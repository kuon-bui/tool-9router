import { Elysia } from "elysia"
import { createGuards, type GuardDeps } from "../guards"
import type { QuotaService } from "./quotaService"
import { cooldownErrorSchema, errorSchema, quotaEntrySchema, refreshAcceptedSchema } from "./schemas"

export type RefreshDeps = GuardDeps & {
  quotaService: Pick<QuotaService, "refreshOne" | "triggerSweep">
}

export function createRefreshRoutes(deps: RefreshDeps) {
  const { quotaService } = deps

  return new Elysia()
    .use(createGuards(deps))
    .post(
      "/refresh",
      ({ status }) => status(202, quotaService.triggerSweep()),
      {
        apiKey: true,
        needsToken: true,
        response: { 202: refreshAcceptedSchema, 401: errorSchema, 503: errorSchema }
      }
    )
    .post(
      "/refresh/:id",
      async ({ params, query, status }) => {
        const outcome = await quotaService.refreshOne(params.id, query.force === "1")

        switch (outcome.kind) {
          case "notFound":
            return status(404, { error: `Không có connection ${params.id}` })
          case "cooldown":
            return status(429, {
              error: "Đang trong cooldown refresh",
              retryAfter: outcome.retryAfterSeconds
            })
          case "ok":
            return outcome.entry
        }
      },
      {
        apiKey: true,
        needsToken: true,
        response: {
          200: quotaEntrySchema,
          401: errorSchema,
          404: errorSchema,
          429: cooldownErrorSchema,
          503: errorSchema
        }
      }
    )
}
