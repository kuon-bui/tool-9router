import { Elysia } from "elysia"

export type FakeUsage =
  | { status: 200; body: unknown }
  | { status: 401; body: unknown }
  | { status: 404; body: unknown }
  | { status: 500; body: unknown }

export type FakeRouterOptions = {
  connections?: unknown
  usage?: Record<string, FakeUsage>
  requireToken?: string
  delayMs?: number
  apiKeys?: unknown
}

export type FakeRouter = {
  url: string
  /** Mọi request đã nhận, để khẳng định force=1 và header token. */
  calls: Array<{ path: string; query: Record<string, string>; token: string | null }>
  setConnections(value: unknown): void
  setUsage(id: string, value: FakeUsage): void
  setApiKeys(value: unknown): void
  stop(): Promise<void>
}

export async function startFakeRouter(opts: FakeRouterOptions = {}): Promise<FakeRouter> {
  let connections: unknown = opts.connections ?? { connections: [] }
  const usage: Record<string, FakeUsage> = { ...(opts.usage ?? {}) }
  let apiKeys: unknown = opts.apiKeys ?? { keys: [] }
  const calls: FakeRouter["calls"] = []

  const app = new Elysia()
    .onRequest(({ request }) => {
      const url = new URL(request.url)
      calls.push({
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        token: request.headers.get("x-9r-cli-token")
      })
    })
    .get("/api/providers", ({ status, request }) => {
      if (opts.requireToken && request.headers.get("x-9r-cli-token") !== opts.requireToken) {
        return status(401, { error: "Unauthorized" })
      }
      return connections
    })
    .get("/api/usage/:id", async ({ params, status }) => {
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs))
      const entry = usage[params.id]
      if (!entry) return status(404, { error: "Not found" })
      return status(entry.status, entry.body)
    })
    .get("/api/keys", ({ status, request }) => {
      if (opts.requireToken && request.headers.get("x-9r-cli-token") !== opts.requireToken) {
        return status(401, { error: "Unauthorized" })
      }
      return apiKeys
    })
    .listen(0)

  const port = app.server?.port
  if (!port) throw new Error("fake router không khởi động được")

  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    setConnections: (value) => {
      connections = value
    },
    setUsage: (id, value) => {
      usage[id] = value
    },
    setApiKeys: (value) => {
      apiKeys = value
    },
    stop: async () => {
      // force:true đóng cả các kết nối keep-alive đang mở — nếu không, fetch có
      // thể tái dùng socket cũ và vẫn nhận được response từ server "đã dừng".
      await app.stop(true)
    }
  }
}
