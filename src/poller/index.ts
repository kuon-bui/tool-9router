import type { SerialQueue } from "../queue"
import type { SnapshotStore } from "../store"
import type { UpstreamClient } from "../upstream"
import type { Connection, QuotaEntry } from "../types"

export type PollerDeps = {
  upstream: UpstreamClient
  store: SnapshotStore
  queue: SerialQueue
  intervalMs: number
  onError?: (message: string) => void
}

export class Poller {
  #deps: PollerDeps
  #timer: ReturnType<typeof setInterval> | null = null
  #healthy = false

  constructor(deps: PollerDeps) {
    this.#deps = deps
  }

  start(): void {
    if (this.#timer) return
    void this.sweep()
    this.#timer = setInterval(() => void this.sweep(), this.#deps.intervalMs)
  }

  stop(): void {
    if (!this.#timer) return
    clearInterval(this.#timer)
    this.#timer = null
  }

  upstreamHealthy(): boolean {
    return this.#healthy
  }

  /**
   * Một vòng quét: làm tươi danh sách connection rồi nạp job ưu tiên thấp cho
   * từng cái. Không bao giờ dùng force — tài liệu cảnh báo nó bỏ qua cache và
   * khiến endpoint quota OAuth của Anthropic khoá cooldown 180s.
   */
  async sweep(): Promise<void> {
    const { upstream, store, queue } = this.#deps

    let connections: Connection[]
    try {
      connections = await queue.enqueue("__providers__", "low", () => upstream.listConnections())
      this.#healthy = true
    } catch (error) {
      this.#healthy = false
      // Không biết trạng thái mới của connection nào — giữ nguyên số liệu cũ
      // nhưng đánh dấu cả snapshot là cũ, đúng yêu cầu "9Router chết giữa
      // chừng vẫn phục vụ snapshot cũ với stale:true".
      store.markAllStale()
      this.#report(`Không lấy được danh sách connection: ${describe(error)}`)
      return
    }

    store.syncConnections(connections)

    for (const conn of connections) {
      try {
        await this.#fetchInto(conn, "low", false)
      } catch (error) {
        // UpstreamClient.fetchUsage() không bao giờ throw, nhưng chính hàng đợi
        // có thể từ chối job (ví dụ đang dừng lúc shutdown). Một connection lỗi
        // không được làm hỏng cả vòng quét — nhất là khi sweep() chạy nền,
        // không có ai await để bắt lỗi (POST /refresh gọi void sweep()).
        this.#report(`${conn.id}: ${describe(error)}`)
      }
    }

    store.markSweep()
  }

  /** Nạp job ưu tiên cao và chờ kết quả. Trả null nếu connection không tồn tại. */
  async refreshOne(connectionId: string, force: boolean): Promise<QuotaEntry | null> {
    const conn = this.#deps.store.connections().find((c) => c.id === connectionId)
    if (!conn) return null

    await this.#fetchInto(conn, "high", force)
    return this.#deps.store.get(connectionId)
  }

  async #fetchInto(conn: Connection, priority: "high" | "low", force: boolean): Promise<void> {
    const { upstream, store } = this.#deps

    const result = await this.#deps.queue.enqueue(`usage:${conn.id}`, priority, () =>
      upstream.fetchUsage(conn.id, force)
    )

    if (result.kind === "missing") {
      store.remove(conn.id)
      return
    }

    store.apply(conn, result)
    if (result.kind === "error") this.#report(`${conn.id}: ${result.message}`)
  }

  #report(message: string): void {
    this.#deps.onError?.(message)
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
