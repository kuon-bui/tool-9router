import type { TokenProvider } from "../auth"
import { classifyUsageResponse, normalizeConnections } from "./normalize"
import type { Connection, UsageResult } from "../types"

export type UpstreamClientOptions = {
  baseUrl: string
  timeoutMs: number
  tokens: TokenProvider
}

export class UpstreamClient {
  #baseUrl: string
  #timeoutMs: number
  #tokens: TokenProvider

  constructor(opts: UpstreamClientOptions) {
    this.#baseUrl = opts.baseUrl.replace(/\/+$/, "")
    this.#timeoutMs = opts.timeoutMs
    this.#tokens = opts.tokens
  }

  /** Ném lỗi khi thất bại — poller quyết định xử lý thế nào. */
  async listConnections(): Promise<Connection[]> {
    const response = await this.#request("/api/providers")
    if (!response.ok) {
      throw new Error(`GET /api/providers trả HTTP ${response.status}`)
    }
    return normalizeConnections(await this.#readJson(response))
  }

  /** Không bao giờ ném — mọi thất bại đều thành `{ kind: "error" }`. */
  async fetchUsage(connectionId: string, force = false): Promise<UsageResult> {
    const path = `/api/usage/${encodeURIComponent(connectionId)}${force ? "?force=1" : ""}`

    let response: Response
    try {
      response = await this.#request(path)
    } catch (error) {
      return { kind: "error", message: describeError(error) }
    }

    return classifyUsageResponse(response.status, await this.#readJson(response))
  }

  async #request(path: string): Promise<Response> {
    const token = await this.#tokens.get()
    return fetch(`${this.#baseUrl}${path}`, {
      headers: { "x-9r-cli-token": token, accept: "application/json" },
      signal: AbortSignal.timeout(this.#timeoutMs)
    })
  }

  async #readJson(response: Response): Promise<unknown> {
    try {
      return await response.json()
    } catch {
      return null
    }
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      return "Hết thời gian chờ 9Router"
    }
    return error.message
  }
  return "Lỗi không xác định khi gọi 9Router"
}
