export type Priority = "high" | "low"

type QueueItem = {
  key: string
  priority: Priority
  seq: number
  task: () => Promise<unknown>
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
}

export type SerialQueueOptions = {
  delayMs: number
  sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Một worker duy nhất, chạy tuần tự, nghỉ `delayMs` sau mỗi job.
 * Đây là điểm duy nhất phát sinh lời gọi ra 9Router, nên "gọi tuần tự có delay"
 * là bất biến của hệ thống chứ không phải quy ước mà mỗi caller tự giữ.
 */
export class SerialQueue {
  #waiting: QueueItem[] = []
  #byKey = new Map<string, QueueItem>()
  #running = false
  #stopped = false
  #seq = 0
  #idle: Promise<void> = Promise.resolve()
  #delayMs: number
  #sleep: (ms: number) => Promise<void>

  constructor(opts: SerialQueueOptions) {
    this.#delayMs = opts.delayMs
    this.#sleep = opts.sleep ?? defaultSleep
  }

  enqueue<T>(key: string, priority: Priority, task: () => Promise<T>): Promise<T> {
    if (this.#stopped) {
      return Promise.reject(new Error("Hàng đợi đã dừng, không nhận job mới"))
    }

    const existing = this.#byKey.get(key)
    if (existing) {
      // Job cho key này đã xếp hàng: chia sẻ kết quả, chỉ nâng ưu tiên nếu cần.
      if (priority === "high" && existing.priority === "low") existing.priority = "high"
      return new Promise<T>((resolve, reject) => {
        this.#chain(existing, resolve as (v: unknown) => void, reject)
      })
    }

    return new Promise<T>((resolve, reject) => {
      const item: QueueItem = {
        key,
        priority,
        seq: this.#seq++,
        task: task as () => Promise<unknown>,
        resolve: resolve as (v: unknown) => void,
        reject
      }
      this.#waiting.push(item)
      this.#byKey.set(key, item)
      void this.#drain()
    })
  }

  pending(): number {
    return this.#waiting.length
  }

  async stop(): Promise<void> {
    this.#stopped = true
    await this.#idle
  }

  /** Gắn thêm một cặp resolve/reject vào một item đã xếp hàng. */
  #chain(
    item: QueueItem,
    resolve: (value: unknown) => void,
    reject: (reason: unknown) => void
  ): void {
    const prevResolve = item.resolve
    const prevReject = item.reject
    item.resolve = (value) => {
      prevResolve(value)
      resolve(value)
    }
    item.reject = (reason) => {
      prevReject(reason)
      reject(reason)
    }
  }

  #take(): QueueItem | undefined {
    if (this.#waiting.length === 0) return undefined
    let bestIndex = 0
    for (let i = 1; i < this.#waiting.length; i++) {
      const candidate = this.#waiting[i]!
      const best = this.#waiting[bestIndex]!
      const better =
        (candidate.priority === "high" && best.priority === "low") ||
        (candidate.priority === best.priority && candidate.seq < best.seq)
      if (better) bestIndex = i
    }
    return this.#waiting.splice(bestIndex, 1)[0]
  }

  async #drain(): Promise<void> {
    if (this.#running) return
    this.#running = true
    this.#idle = this.#loop()
    await this.#idle
  }

  async #loop(): Promise<void> {
    try {
      for (;;) {
        const item = this.#take()
        if (!item) return
        this.#byKey.delete(item.key)

        try {
          item.resolve(await item.task())
        } catch (error) {
          item.reject(error)
        }

        if (this.#delayMs > 0) await this.#sleep(this.#delayMs)
      }
    } finally {
      this.#running = false
    }
  }
}
