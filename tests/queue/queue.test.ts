import { describe, expect, it } from "bun:test"
import { SerialQueue } from "../../src/queue"

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms))

describe("SerialQueue", () => {
  it("không bao giờ chạy hai job cùng lúc", async () => {
    const queue = new SerialQueue({ delayMs: 0 })
    let running = 0
    let maxConcurrent = 0

    const job = async () => {
      running += 1
      maxConcurrent = Math.max(maxConcurrent, running)
      await tick(5)
      running -= 1
    }

    await Promise.all(
      Array.from({ length: 10 }, (_, i) => queue.enqueue(`k${i}`, "low", job))
    )

    expect(maxConcurrent).toBe(1)
    await queue.stop()
  })

  it("trả về giá trị của task", async () => {
    const queue = new SerialQueue({ delayMs: 0 })
    expect(await queue.enqueue("k", "low", async () => 42)).toBe(42)
    await queue.stop()
  })

  it("lỗi của task được ném lại cho người gọi mà không chặn hàng đợi", async () => {
    const queue = new SerialQueue({ delayMs: 0 })
    const failing = queue.enqueue("a", "low", async () => {
      throw new Error("boom")
    })
    await expect(failing).rejects.toThrow("boom")
    expect(await queue.enqueue("b", "low", async () => "vẫn chạy")).toBe("vẫn chạy")
    await queue.stop()
  })

  it("nghỉ delayMs giữa hai job", async () => {
    const slept: number[] = []
    const queue = new SerialQueue({
      delayMs: 1_500,
      sleep: async (ms) => {
        slept.push(ms)
      }
    })

    await queue.enqueue("a", "low", async () => 1)
    await queue.enqueue("b", "low", async () => 2)
    await queue.stop()

    expect(slept.every((ms) => ms === 1_500)).toBe(true)
    expect(slept.length).toBeGreaterThanOrEqual(2)
  })

  it("job ưu tiên cao chen lên trước job ưu tiên thấp đang chờ", async () => {
    const queue = new SerialQueue({ delayMs: 0 })
    const order: string[] = []

    // Job đầu chiếm worker để những job sau phải xếp hàng thật.
    const blocker = queue.enqueue("blocker", "low", async () => {
      await tick(20)
      order.push("blocker")
    })

    await tick(1)
    const low = queue.enqueue("low", "low", async () => {
      order.push("low")
    })
    const high = queue.enqueue("high", "high", async () => {
      order.push("high")
    })

    await Promise.all([blocker, low, high])
    expect(order).toEqual(["blocker", "high", "low"])
    await queue.stop()
  })

  it("dedup: hai lần enqueue cùng key chỉ chạy task một lần", async () => {
    const queue = new SerialQueue({ delayMs: 0 })
    let calls = 0

    const blocker = queue.enqueue("blocker", "low", () => tick(20))
    await tick(1)

    const task = async () => {
      calls += 1
      return "kết quả"
    }
    const first = queue.enqueue("same", "low", task)
    const second = queue.enqueue("same", "low", task)

    const [a, b] = await Promise.all([first, second])
    await blocker

    expect(calls).toBe(1)
    expect(a).toBe("kết quả")
    expect(b).toBe("kết quả")
    await queue.stop()
  })

  it("dedup nâng ưu tiên khi job đang chờ được enqueue lại ở mức cao", async () => {
    const queue = new SerialQueue({ delayMs: 0 })
    const order: string[] = []

    const blocker = queue.enqueue("blocker", "low", () => tick(20))
    await tick(1)

    const a = queue.enqueue("a", "low", async () => {
      order.push("a")
    })
    const b = queue.enqueue("b", "low", async () => {
      order.push("b")
    })
    const aAgain = queue.enqueue("a", "high", async () => {
      order.push("a-lần-hai")
    })

    await Promise.all([blocker, a, b, aAgain])
    expect(order).toEqual(["a", "b"])
    await queue.stop()
  })

  it("pending đếm số job đang chờ", async () => {
    const queue = new SerialQueue({ delayMs: 0 })
    const blocker = queue.enqueue("blocker", "low", () => tick(20))
    await tick(1)
    const a = queue.enqueue("a", "low", async () => 1)
    const b = queue.enqueue("b", "low", async () => 2)
    expect(queue.pending()).toBe(2)
    await Promise.all([blocker, a, b])
    expect(queue.pending()).toBe(0)
    await queue.stop()
  })

  it("stop từ chối job mới", async () => {
    const queue = new SerialQueue({ delayMs: 0 })
    await queue.stop()
    await expect(queue.enqueue("a", "low", async () => 1)).rejects.toThrow(/đã dừng/)
  })
})
