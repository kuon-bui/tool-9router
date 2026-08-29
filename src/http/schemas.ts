import { t } from "elysia"

export const errorSchema = t.Object({
  error: t.String()
})

export const cooldownErrorSchema = t.Object({
  error: t.String(),
  retryAfter: t.Number()
})

const entryStatusSchema = t.UnionEnum(["ok", "unavailable", "unauthorized", "error", "pending"])

/** Tên pool khác nhau theo provider — schema chỉ ràng buộc hình dạng của MỘT pool. */
const quotaPoolSchema = t.Object({
  used: t.Nullable(t.Number()),
  total: t.Nullable(t.Number()),
  remaining: t.Nullable(t.Number()),
  resetAt: t.Nullable(t.String()),
  unlimited: t.Boolean()
})

export const quotaEntrySchema = t.Object({
  connectionId: t.String(),
  provider: t.String(),
  name: t.Nullable(t.String()),
  authType: t.Nullable(t.String()),
  status: entryStatusSchema,
  plan: t.Nullable(t.String()),
  quotas: t.Nullable(t.Record(t.String(), quotaPoolSchema)),
  message: t.Nullable(t.String()),
  fetchedAt: t.Nullable(t.String()),
  stale: t.Boolean()
})

export const quotaListSchema = t.Object({
  count: t.Number(),
  lastSweepAt: t.Nullable(t.String()),
  entries: t.Array(quotaEntrySchema)
})

export const healthSchema = t.Object({
  ok: t.Boolean(),
  upstream: t.UnionEnum(["up", "down"]),
  tokenReady: t.Boolean(),
  hint: t.Nullable(t.String()),
  connections: t.Number(),
  lastSweepAt: t.Nullable(t.String())
})

export const refreshAcceptedSchema = t.Object({
  accepted: t.Literal(true),
  connections: t.Number()
})
