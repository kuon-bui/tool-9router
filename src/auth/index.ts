import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { homedir as osHomedir } from "node:os"
import { join } from "node:path"

const SALT = "9r-cli-auth"

export type ResolveDataDirOptions = {
  override?: string | undefined
  platform: string
  appData?: string | undefined
  homedir: string
}

export function resolveDataDir(opts: ResolveDataDirOptions): string {
  const isWindows = opts.platform === "win32"
  const override = opts.override?.trim()

  // Trên Windows, đường dẫn kiểu Unix lọt từ .env của Linux — bỏ qua.
  if (override && !(isWindows && override.startsWith("/"))) return override

  if (isWindows) {
    const appData = opts.appData?.trim() || join(opts.homedir, "AppData", "Roaming")
    return join(appData, "9router")
  }

  return join(opts.homedir, ".9router")
}

export function resolveDataDirFromEnv(override: string | undefined): string {
  return resolveDataDir({
    override,
    platform: process.platform,
    appData: process.env.APPDATA,
    homedir: osHomedir()
  })
}

export async function computeCliToken(dataDir: string): Promise<string> {
  const [rawMachineId, rawSecret] = await Promise.all([
    readFile(join(dataDir, "machine-id"), "utf8"),
    readFile(join(dataDir, "auth", "cli-secret"), "utf8")
  ])

  const machineId = rawMachineId.trim()
  const secret = rawSecret.trim()

  if (!machineId) throw new Error(`machine-id rỗng tại ${dataDir}`)
  if (!secret) throw new Error(`cli-secret rỗng tại ${dataDir}`)

  return createHash("sha256")
    .update(machineId + SALT + secret)
    .digest("hex")
    .substring(0, 16)
}

export type TokenProvider = {
  get(): Promise<string>
  isReady(): boolean
}

export function createTokenProvider(dataDir: string): TokenProvider {
  let cached: string | null = null

  return {
    async get(): Promise<string> {
      if (cached !== null) return cached
      // Chỉ cache khi thành công: thất bại phải được thử lại ở vòng quét sau.
      cached = await computeCliToken(dataDir)
      return cached
    },
    isReady: () => cached !== null
  }
}
