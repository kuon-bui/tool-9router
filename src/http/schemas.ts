import { z } from "zod"
import { ENTRY_STATUSES } from "../types"

export const errorSchema = z.object({
  error: z.string()
})

export const cooldownErrorSchema = z.object({
  error: z.string(),
  retryAfter: z.number()
})

const entryStatusSchema = z.enum(ENTRY_STATUSES)

/** Tên pool khác nhau theo provider — schema chỉ ràng buộc hình dạng của MỘT pool. */
const quotaPoolSchema = z.object({
  used: z.number().nullable(),
  total: z.number().nullable(),
  remaining: z.number().nullable(),
  resetAt: z.string().nullable(),
  unlimited: z.boolean()
})

export const quotaEntrySchema = z.object({
  connectionId: z.string(),
  provider: z.string(),
  name: z.string().nullable(),
  authType: z.string().nullable(),
  status: entryStatusSchema,
  plan: z.string().nullable(),
  quotas: z.record(z.string(), quotaPoolSchema).nullable(),
  message: z.string().nullable(),
  fetchedAt: z.string().nullable(),
  stale: z.boolean()
})

export const quotaListSchema = z.object({
  count: z.number(),
  lastSweepAt: z.string().nullable(),
  entries: z.array(quotaEntrySchema)
})

export const healthSchema = z.object({
  ok: z.boolean(),
  upstream: z.enum(["up", "down"]),
  tokenReady: z.boolean(),
  hint: z.string().nullable(),
  connections: z.number(),
  lastSweepAt: z.string().nullable()
})

export const refreshAcceptedSchema = z.object({
  accepted: z.literal(true),
  connections: z.number()
})
