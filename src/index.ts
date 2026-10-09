import { createTokenProvider, resolveDataDirFromEnv } from "./auth"
import { loadConfig } from "./config"
import { createRouterKeyCache } from "./guards/routerKeyCache"
import { Poller } from "./poller"
import { SerialQueue } from "./queue"
import { createServer } from "./http"
import { SnapshotStore } from "./store"
import { UpstreamClient } from "./upstream"

export type RunningServer = {
  port: number
  stop: () => Promise<void>
}

export async function bootstrap(
  env: Record<string, string | undefined>
): Promise<RunningServer> {
  const config = loadConfig(env)
  const dataDir = resolveDataDirFromEnv(config.dataDirOverride)
  const tokens = createTokenProvider(dataDir)

  const store = new SnapshotStore({
    staleAfterMs: config.pollIntervalMs * 2,
    now: () => Date.now()
  })
  const queue = new SerialQueue({ delayMs: config.requestDelayMs })
  const upstream = new UpstreamClient({
    baseUrl: config.upstreamUrl,
    timeoutMs: config.upstreamTimeoutMs,
    tokens
  })

  const poller = new Poller({
    upstream,
    store,
    queue,
    intervalMs: config.pollIntervalMs,
    reconnectIntervalMs: config.reconnectIntervalMs,
    onError: (message) => console.warn(`[poller] ${message}`),
    onRecovered: () => console.log("[poller] đã kết nối lại 9Router thành công")
  })

  // Tính CLI token một lần, trước khi mở cổng, rồi giữ trong RAM.
  // Thất bại KHÔNG được coi là lỗi chí mạng: 9Router có thể chưa từng chạy nên
  // chưa sinh file. Crash ở đây sẽ khiến service vào vòng restart vô tận. Server
  // vẫn lên, /health báo tokenReady:false, và createTokenProvider sẽ thử đọc lại
  // ở vòng quét kế tiếp — tự hồi phục ngay khi file xuất hiện.
  try {
    await tokens.get()
  } catch (error) {
    console.warn(
      `[token] chưa đọc được CLI token tại ${dataDir}: ` +
        `${error instanceof Error ? error.message : String(error)}`
    )
    console.warn("[token] hãy chạy 9Router một lần để nó sinh machine-id và auth/cli-secret")
  }

  const routerKeys = config.allowRouterApiKeys
    ? createRouterKeyCache({ upstream, ttlMs: config.routerApiKeysCacheTtlMs, now: () => Date.now() })
    : null

  const app = createServer({ config, store, poller, tokens, now: () => Date.now(), routerKeys })
  app.listen({ port: config.port, hostname: config.host })

  const port = app.server?.port
  if (!port) throw new Error(`Không bind được ${config.host}:${config.port}`)

  console.log(`quota server lắng nghe tại http://${config.host}:${port}`)
  console.log(`upstream 9Router: ${config.upstreamUrl}`)
  console.log(`DATA_DIR: ${dataDir}`)

  poller.start()

  return {
    port,
    stop: async () => {
      poller.stop()
      await queue.stop()
      await app.stop()
    }
  }
}

if (import.meta.main) {
  try {
    const app = await bootstrap(process.env)
    const shutdown = () => {
      console.log("đang dừng…")
      void app.stop().then(() => process.exit(0))
    }
    process.on("SIGINT", shutdown)
    process.on("SIGTERM", shutdown)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
