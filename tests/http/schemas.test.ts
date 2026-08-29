import { describe, expect, it } from "bun:test"
import { Elysia } from "elysia"
import { quotaListSchema } from "../../src/http/schemas"

describe("quotaListSchema (zod) qua Elysia response validation", () => {
  it("chặn response sai shape với 422", async () => {
    const app = new Elysia().get(
      "/bad",
      () => ({ count: "không phải số", lastSweepAt: null, entries: [] }) as any,
      { response: { 200: quotaListSchema } }
    )

    const res = await app.handle(new Request("http://localhost/bad"))
    expect(res.status).toBe(422)
  })

  it("chấp nhận response đúng shape với 200", async () => {
    const app = new Elysia().get(
      "/good",
      () => ({ count: 0, lastSweepAt: null, entries: [] }),
      { response: { 200: quotaListSchema } }
    )

    const res = await app.handle(new Request("http://localhost/good"))
    expect(res.status).toBe(200)
  })
})
