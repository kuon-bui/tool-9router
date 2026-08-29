import { afterEach, describe, expect, it } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { bootstrap } from "../src/index"
import { startFakeRouter, type FakeRouter } from "./fixtures/fakeRouter"

let router: FakeRouter | null = null
let stopServer: (() => Promise<void>) | null = null
let dataDir: string | null = null

afterEach(async () => {
  await stopServer?.()
  stopServer = null
  await router?.stop()
  router = null
  if (dataDir) await rm(dataDir, { recursive: true, force: true })
  dataDir = null
})

async function makeDataDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "qs-boot-"))
  await writeFile(join(dir, "machine-id"), "machine-abc", "utf8")
  await mkdir(join(dir, "auth"), { recursive: true })
  await writeFile(join(dir, "auth", "cli-secret"), "secret-def", "utf8")
  return dir
}

describe("bootstrap", () => {
  it("khởi động, quét được quota và phục vụ qua HTTP thật", async () => {
    dataDir = await makeDataDir()
    router = await startFakeRouter({
      connections: {
        connections: [{ id: "c1", provider: "kiro", authType: "oauth", name: "Kiro #1" }]
      },
      usage: {
        c1: { status: 200, body: { plan: "Kiro Pro", quotas: { credit: { used: 3, total: 10 } } } }
      },
      requireToken: "cb123c9417802816"
    })

    const app = await bootstrap({
      API_KEY: "smoke-key",
      PORT: "0",
      HOST: "127.0.0.1",
      UPSTREAM_URL: router.url,
      DATA_DIR: dataDir,
      POLL_INTERVAL_MS: "600000",
      REQUEST_DELAY_MS: "1"
    })
    stopServer = app.stop

    // Chờ vòng quét đầu tiên hoàn tất.
    for (let i = 0; i < 100; i++) {
      const probe = await fetch(`http://127.0.0.1:${app.port}/health`)
      const health = (await probe.json()) as any
      if (health.connections === 1 && health.lastSweepAt) break
      await new Promise((r) => setTimeout(r, 20))
    }

    const res = await fetch(`http://127.0.0.1:${app.port}/quotas`, {
      headers: { "x-api-key": "smoke-key" }
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.entries[0].quotas.credit.used).toBe(3)
  })

  it("ném ConfigError khi thiếu API_KEY", async () => {
    await expect(bootstrap({})).rejects.toThrow(/API_KEY/)
  })
})
