import { safeEqual } from "./index"
import type { RouterApiKey } from "../types"

export type RouterKeyUpstream = {
  listApiKeys(): Promise<RouterApiKey[]>
}

export type RouterKeyCache = {
  isValid(candidate: string): Promise<boolean>
}

export type RouterKeyCacheOptions = {
  upstream: RouterKeyUpstream
  ttlMs: number
  now: () => number
}

/**
 * Không dùng cache cũ khi refetch lỗi: quyết định vận hành là thà từ chối
 * oan (401) còn hơn chấp nhận một key vừa bị 9Router thu hồi.
 */
export function createRouterKeyCache(opts: RouterKeyCacheOptions): RouterKeyCache {
  let cached: RouterApiKey[] | null = null
  let expiresAt = 0
  let inflight: Promise<RouterApiKey[]> | null = null

  async function refresh(): Promise<RouterApiKey[]> {
    if (inflight) return inflight

    inflight = opts.upstream
      .listApiKeys()
      .then((keys) => {
        cached = keys
        expiresAt = opts.now() + opts.ttlMs
        return keys
      })
      .finally(() => {
        inflight = null
      })

    return inflight
  }

  return {
    async isValid(candidate) {
      const keys = cached !== null && opts.now() < expiresAt ? cached : await refresh()
      return keys.some((k) => k.isActive && safeEqual(candidate, k.key))
    }
  }
}
