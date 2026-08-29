import { Elysia } from "elysia"
import { timingSafeEqual } from "node:crypto"
import type { Config } from "../config"
import type { TokenProvider } from "../auth"

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8")
  const right = Buffer.from(b, "utf8")
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

export const TOKEN_HINT =
  "Chưa đọc được CLI token. Hãy chạy 9Router một lần để nó sinh machine-id và auth/cli-secret."

export type GuardDeps = {
  config: Config
  tokens: TokenProvider
}

/**
 * Hai macro dùng chung cho mọi route trừ /health: `apiKey` xác thực service
 * bên ngoài, `needsToken` chặn khi chưa đọc được CLI token của 9Router.
 */
/**
 * Nhận key qua `x-api-key` hoặc `Authorization: Bearer <key>` — nhiều client
 * MCP chỉ cho điền một ô token duy nhất và tự đặt nó vào Authorization.
 */
function extractApiKey(headers: Record<string, string | undefined>): string | null {
  const direct = headers["x-api-key"]
  if (typeof direct === "string") return direct

  const auth = headers["authorization"]
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    return auth.slice("Bearer ".length)
  }

  return null
}

export function createGuards({ config, tokens }: GuardDeps) {
  return new Elysia().macro({
    apiKey: {
      resolve({ headers, status }) {
        const provided = extractApiKey(headers)
        if (provided === null || !safeEqual(provided, config.apiKey)) {
          return status(401, { error: "Unauthorized" })
        }
        return {}
      }
    },
    needsToken: {
      resolve({ status }) {
        // bootstrap() đã tính token trước khi listen(), nên tới đây token hoặc
        // đã sẵn sàng, hoặc thật sự đọc không được.
        if (!tokens.isReady()) return status(503, { error: TOKEN_HINT })
        return {}
      }
    }
  })
}
