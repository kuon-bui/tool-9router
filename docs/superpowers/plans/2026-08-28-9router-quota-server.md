# 9Router Quota Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Một mini HTTP server chạy cùng máy với 9Router, expose quota của mọi connection cho service bên ngoài qua API gọn, ổn định, và an toàn với rate-limit của provider.

**Architecture:** Mọi lời gọi ra 9Router đi qua đúng một worker tuần tự có delay. Một poller nền quét toàn bộ connection theo chu kỳ và ghi kết quả vào snapshot in-memory; handler HTTP đọc snapshot rồi trả ngay, không bao giờ chờ upstream. Endpoint refresh nạp job ưu tiên cao vào cùng hàng đợi đó.

**Tech Stack:** Bun 1.3+, Elysia 1.3+, TypeScript, `bun:test`. Không dùng thư viện ngoài nào khác — SHA256, đọc file, HTTP client đều có sẵn trong Bun/Node stdlib.

**Spec:** `docs/superpowers/specs/2026-08-28-9router-quota-server-design.md`

## Global Constraints

- Bun `>= 1.3`, Elysia `>= 1.3`. Không thêm dependency runtime nào ngoài `elysia`.
- Ngôn ngữ TypeScript, ESM, `"type": "module"`.
- Salt CLI token là chuỗi literal `9r-cli-auth`, nối trực tiếp không dấu phân cách, lấy **16 ký tự đầu** của hex digest.
- Header xác thực gửi lên 9Router: `x-9r-cli-token`. Header client gửi vào server này: `x-api-key`.
- **Không bao giờ log hoặc trả CLI token ra response**, kể cả `/health` và body lỗi.
- **Không hardcode tên pool quota** (`credit`, `session`, `weekly`, …) và **không hardcode danh sách provider hỗ trợ quota**. Luôn duyệt key và kiểm tra sự tồn tại của trường `quotas`.
- Vòng poll nền **không bao giờ** dùng `force=1`.
- Port mặc định `20129`, host mặc định `0.0.0.0`, upstream mặc định `http://localhost:20128`.
- Mọi module nghiệp vụ nhận thời gian qua tham số `now: () => number` để test không phụ thuộc đồng hồ thật.

---

### Task 1: Scaffold project

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `src/types.ts`
- Test: `tests/types.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: các kiểu dùng xuyên suốt — `QuotaPool`, `EntryStatus`, `QuotaEntry`, `Connection`, `UsageResult`, `AppliedResult`

- [ ] **Step 1: Khởi tạo git repo và cài dependency**

```bash
git init
bun init -y
bun add elysia
bun add -d @types/bun
```

- [ ] **Step 2: Ghi đè `package.json`**

```json
{
  "name": "9router-quota-server",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "scripts": {
    "start": "bun run src/index.ts",
    "dev": "bun --watch src/index.ts",
    "test": "bun test"
  },
  "dependencies": {
    "elysia": "^1.3.0"
  },
  "devDependencies": {
    "@types/bun": "latest"
  }
}
```

- [ ] **Step 3: Ghi `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["bun-types"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 4: Ghi `.gitignore`**

```
node_modules/
.env
*.log
```

- [ ] **Step 5: Viết test thất bại cho module types**

Tạo `tests/types.test.ts`:

```ts
import { describe, expect, it } from "bun:test"
import { isEntryStatus } from "../src/types"

describe("isEntryStatus", () => {
  it("nhận đúng năm giá trị hợp lệ", () => {
    for (const s of ["ok", "unavailable", "unauthorized", "error", "pending"]) {
      expect(isEntryStatus(s)).toBe(true)
    }
  })

  it("từ chối giá trị lạ", () => {
    expect(isEntryStatus("missing")).toBe(false)
    expect(isEntryStatus("")).toBe(false)
  })
})
```

- [ ] **Step 6: Chạy test cho chắc nó fail**

Run: `bun test tests/types.test.ts`
Expected: FAIL — không resolve được `../src/types`

- [ ] **Step 7: Viết `src/types.ts`**

```ts
export type QuotaPool = {
  used: number | null
  total: number | null
  remaining: number | null
  resetAt: string | null
  unlimited: boolean
}

export const ENTRY_STATUSES = [
  "ok",
  "unavailable",
  "unauthorized",
  "error",
  "pending"
] as const

export type EntryStatus = (typeof ENTRY_STATUSES)[number]

export function isEntryStatus(value: unknown): value is EntryStatus {
  return typeof value === "string" && (ENTRY_STATUSES as readonly string[]).includes(value)
}

export type QuotaEntry = {
  connectionId: string
  provider: string
  name: string | null
  authType: string | null
  status: EntryStatus
  plan: string | null
  quotas: Record<string, QuotaPool> | null
  message: string | null
  fetchedAt: string | null
  stale: boolean
}

/** Entry như store giữ bên trong: chưa tính `stale`. */
export type StoredEntry = {
  entry: Omit<QuotaEntry, "stale">
  failed: boolean
}

export type Connection = {
  id: string
  provider: string
  name: string | null
  authType: string | null
}

export type UsageResult =
  | { kind: "quotas"; plan: string | null; quotas: Record<string, QuotaPool> }
  | { kind: "message"; message: string }
  | { kind: "unauthorized"; message: string }
  | { kind: "missing" }
  | { kind: "error"; message: string }

/** `missing` được xử lý bằng cách gỡ khỏi store, không đi qua applyResult. */
export type AppliedResult = Exclude<UsageResult, { kind: "missing" }>
```

- [ ] **Step 8: Chạy test cho chắc nó pass**

Run: `bun test tests/types.test.ts`
Expected: PASS, 2 tests

- [ ] **Step 9: Commit**

```bash
git add package.json tsconfig.json .gitignore bun.lock src/types.ts tests/types.test.ts
git commit -m "chore: scaffold bun + elysia project with shared types"
```

---

### Task 2: Config từ biến môi trường

**Files:**
- Create: `src/config.ts`
- Test: `tests/config.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `type Config`, `class ConfigError extends Error`, `loadConfig(env: Record<string, string | undefined>): Config`

- [ ] **Step 1: Viết test thất bại**

Tạo `tests/config.test.ts`:

```ts
import { describe, expect, it } from "bun:test"
import { ConfigError, loadConfig } from "../src/config"

const base = { API_KEY: "k" }

describe("loadConfig", () => {
  it("điền đủ mặc định khi chỉ có API_KEY", () => {
    const cfg = loadConfig(base)
    expect(cfg.apiKey).toBe("k")
    expect(cfg.port).toBe(20129)
    expect(cfg.host).toBe("0.0.0.0")
    expect(cfg.upstreamUrl).toBe("http://localhost:20128")
    expect(cfg.pollIntervalMs).toBe(300_000)
    expect(cfg.requestDelayMs).toBe(1_500)
    expect(cfg.refreshCooldownMs).toBe(60_000)
    expect(cfg.upstreamTimeoutMs).toBe(20_000)
  })

  it("ném ConfigError khi thiếu API_KEY", () => {
    expect(() => loadConfig({})).toThrow(ConfigError)
  })

  it("ném ConfigError khi API_KEY rỗng hoặc chỉ có khoảng trắng", () => {
    expect(() => loadConfig({ API_KEY: "   " })).toThrow(ConfigError)
  })

  it("đọc giá trị số từ env", () => {
    const cfg = loadConfig({ ...base, PORT: "31000", POLL_INTERVAL_MS: "60000" })
    expect(cfg.port).toBe(31_000)
    expect(cfg.pollIntervalMs).toBe(60_000)
  })

  it("ném ConfigError khi số không hợp lệ", () => {
    expect(() => loadConfig({ ...base, PORT: "abc" })).toThrow(ConfigError)
    expect(() => loadConfig({ ...base, POLL_INTERVAL_MS: "-5" })).toThrow(ConfigError)
    expect(() => loadConfig({ ...base, POLL_INTERVAL_MS: "0" })).toThrow(ConfigError)
  })

  it("cho phép PORT=0 để hệ điều hành tự chọn cổng", () => {
    expect(loadConfig({ ...base, PORT: "0" }).port).toBe(0)
  })

  it("ném ConfigError khi PORT ngoài dải hợp lệ", () => {
    expect(() => loadConfig({ ...base, PORT: "70000" })).toThrow(ConfigError)
    expect(() => loadConfig({ ...base, PORT: "-1" })).toThrow(ConfigError)
  })

  it("cắt dấu / thừa ở cuối upstreamUrl", () => {
    const cfg = loadConfig({ ...base, UPSTREAM_URL: "http://localhost:20128/" })
    expect(cfg.upstreamUrl).toBe("http://localhost:20128")
  })

  it("giữ nguyên DATA_DIR khi được đặt", () => {
    const cfg = loadConfig({ ...base, DATA_DIR: "C:\\data\\9router" })
    expect(cfg.dataDirOverride).toBe("C:\\data\\9router")
  })
})
```

- [ ] **Step 2: Chạy test cho chắc nó fail**

Run: `bun test tests/config.test.ts`
Expected: FAIL — không resolve được `../src/config`

- [ ] **Step 3: Viết `src/config.ts`**

```ts
export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ConfigError"
  }
}

export type Config = {
  apiKey: string
  port: number
  host: string
  upstreamUrl: string
  dataDirOverride: string | undefined
  pollIntervalMs: number
  requestDelayMs: number
  refreshCooldownMs: number
  upstreamTimeoutMs: number
}

function readPositiveInt(
  env: Record<string, string | undefined>,
  key: string,
  fallback: number
): number {
  const raw = env[key]
  if (raw === undefined || raw.trim() === "") return fallback
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ConfigError(`${key} phải là số nguyên dương, nhận được "${raw}"`)
  }
  return parsed
}

/** PORT=0 hợp lệ: bảo hệ điều hành tự chọn cổng trống — test smoke dùng cách này. */
function readPort(env: Record<string, string | undefined>, fallback: number): number {
  const raw = env.PORT
  if (raw === undefined || raw.trim() === "") return fallback
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535) {
    throw new ConfigError(`PORT phải là số nguyên trong khoảng 0–65535, nhận được "${raw}"`)
  }
  return parsed
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const apiKey = env.API_KEY?.trim()
  if (!apiKey) {
    throw new ConfigError(
      "Thiếu API_KEY. Server bind ra ngoài và nắm CLI token có toàn quyền dashboard 9Router, " +
        "nên bắt buộc phải đặt API_KEY trước khi chạy."
    )
  }

  const upstreamRaw = env.UPSTREAM_URL?.trim() || "http://localhost:20128"

  return {
    apiKey,
    port: readPort(env, 20_129),
    host: env.HOST?.trim() || "0.0.0.0",
    upstreamUrl: upstreamRaw.replace(/\/+$/, ""),
    dataDirOverride: env.DATA_DIR?.trim() || undefined,
    pollIntervalMs: readPositiveInt(env, "POLL_INTERVAL_MS", 300_000),
    requestDelayMs: readPositiveInt(env, "REQUEST_DELAY_MS", 1_500),
    refreshCooldownMs: readPositiveInt(env, "REFRESH_COOLDOWN_MS", 60_000),
    upstreamTimeoutMs: readPositiveInt(env, "UPSTREAM_TIMEOUT_MS", 20_000)
  }
}
```

- [ ] **Step 4: Chạy test cho chắc nó pass**

Run: `bun test tests/config.test.ts`
Expected: PASS, 9 tests

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat: load and validate configuration from environment"
```

---

### Task 3: CLI token cho 9Router

**Files:**
- Create: `src/cliToken.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `resolveDataDir(opts: { override?: string; platform: string; appData?: string; homedir: string }): string`
  - `resolveDataDirFromEnv(override: string | undefined): string`
  - `computeCliToken(dataDir: string): Promise<string>`
  - `type TokenProvider = { get(): Promise<string>; isReady(): boolean }`
  - `createTokenProvider(dataDir: string): TokenProvider`

**Task này không có test file riêng — có chủ ý.** Công thức token vẫn được kiểm
end-to-end ở Task 10: smoke test dựng thư mục dữ liệu giả `machine-abc` /
`secret-def` và bắt fake 9Router chỉ chấp nhận đúng token `cb123c9417802816`. Sai
thứ tự nối chuỗi, sai salt, hay quên cắt 16 ký tự đều làm smoke test đỏ.

**Token được tính một lần lúc boot rồi giữ trong RAM.** `bootstrap()` gọi `get()`
trước khi `listen()`, nên tới lúc server nhận request đầu tiên thì token đã sẵn
sàng. Machine ID và cli-secret không đổi khi 9Router đang chạy, nên đọc lại mỗi
lần là thừa.

**Chỉ cache khi thành công.** Thất bại không được cache — đó là điều làm server
tự hồi phục: nếu 9Router chưa từng chạy nên chưa có file, lần `get()` kế tiếp từ
vòng quét sau sẽ thử đọc lại, và bắt được ngay khi file xuất hiện. Vì thế không
cần method `reset()`.

**Ghi chú quan trọng:** trên Windows, giá trị `DATA_DIR` bắt đầu bằng `/` phải bị
**bỏ qua** — đó là đường dẫn Unix lọt từ `.env` của Linux. 9Router làm đúng như
vậy trong `src/lib/dataDir.js`.

- [ ] **Step 1: Viết `src/cliToken.ts`**

```ts
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
```

- [ ] **Step 2: Kiểm tra kiểu**

Run: `bunx tsc --noEmit`
Expected: không có lỗi

- [ ] **Step 3: Commit**

```bash
git add src/cliToken.ts
git commit -m "feat: derive 9router cli token once at boot and keep it in memory"
```

---

### Task 4: Chuẩn hoá response quota

**Files:**
- Create: `src/normalize.ts`
- Test: `tests/normalize.test.ts`

**Interfaces:**
- Consumes: `src/types.ts`
- Produces:
  - `normalizePools(raw: unknown): Record<string, QuotaPool>`
  - `classifyUsageResponse(httpStatus: number, body: unknown): UsageResult`
  - `normalizeConnections(body: unknown): Connection[]`
  - `pendingEntry(conn: Connection): StoredEntry`
  - `applyResult(prev: StoredEntry | null, conn: Connection, result: AppliedResult, nowIso: string): StoredEntry`

- [ ] **Step 1: Viết test thất bại**

Tạo `tests/normalize.test.ts`:

```ts
import { describe, expect, it } from "bun:test"
import {
  applyResult,
  classifyUsageResponse,
  normalizeConnections,
  normalizePools,
  pendingEntry
} from "../src/normalize"
import type { Connection, StoredEntry } from "../src/types"

const conn: Connection = {
  id: "c1",
  provider: "kiro",
  name: "Kiro #1",
  authType: "oauth"
}

const NOW = "2026-08-28T10:15:03.000Z"

describe("normalizePools", () => {
  it("giữ nguyên tên pool chưa từng thấy", () => {
    const pools = normalizePools({
      some_brand_new_pool: { used: 1, total: 2, remaining: 1, unlimited: false }
    })
    expect(Object.keys(pools)).toEqual(["some_brand_new_pool"])
  })

  it("điền null cho trường thiếu và false cho unlimited", () => {
    const pools = normalizePools({ credit: {} })
    expect(pools.credit).toEqual({
      used: null,
      total: null,
      remaining: null,
      resetAt: null,
      unlimited: false
    })
  })

  it("giữ nguyên số và resetAt", () => {
    const pools = normalizePools({
      credit: {
        used: 12.5,
        total: 50,
        remaining: 37.5,
        resetAt: "2026-09-01T00:00:00.000Z",
        unlimited: false
      }
    })
    expect(pools.credit).toEqual({
      used: 12.5,
      total: 50,
      remaining: 37.5,
      resetAt: "2026-09-01T00:00:00.000Z",
      unlimited: false
    })
  })

  it("bỏ qua giá trị pool không phải object", () => {
    const pools = normalizePools({ credit: "nonsense", weekly: { used: 1 } })
    expect(Object.keys(pools)).toEqual(["weekly"])
  })

  it("trả object rỗng khi input không phải object", () => {
    expect(normalizePools(null)).toEqual({})
    expect(normalizePools("x")).toEqual({})
  })
})

describe("classifyUsageResponse", () => {
  it("200 có quotas -> kind quotas", () => {
    const result = classifyUsageResponse(200, {
      plan: "Kiro Pro",
      quotas: { credit: { used: 1, total: 2 } }
    })
    expect(result.kind).toBe("quotas")
    if (result.kind !== "quotas") throw new Error("unreachable")
    expect(result.plan).toBe("Kiro Pro")
    expect(result.quotas.credit?.used).toBe(1)
  })

  it("200 có message -> kind message", () => {
    const result = classifyUsageResponse(200, {
      message: "Usage not available for this connection"
    })
    expect(result).toEqual({
      kind: "message",
      message: "Usage not available for this connection"
    })
  })

  it("200 quotas rỗng vẫn là kind quotas", () => {
    const result = classifyUsageResponse(200, { quotas: {} })
    expect(result.kind).toBe("quotas")
  })

  it("200 không quotas không message -> kind message với mô tả mặc định", () => {
    const result = classifyUsageResponse(200, {})
    expect(result.kind).toBe("message")
  })

  it("401 -> kind unauthorized", () => {
    expect(classifyUsageResponse(401, { error: "Unauthorized" }).kind).toBe("unauthorized")
  })

  it("404 -> kind missing", () => {
    expect(classifyUsageResponse(404, {})).toEqual({ kind: "missing" })
  })

  it("500 -> kind error", () => {
    expect(classifyUsageResponse(500, {}).kind).toBe("error")
  })

  it("429 -> kind error", () => {
    expect(classifyUsageResponse(429, {}).kind).toBe("error")
  })
})

describe("normalizeConnections", () => {
  it("đọc mảng connections và điền null cho trường thiếu", () => {
    const conns = normalizeConnections({
      connections: [{ id: "c1", provider: "kiro" }]
    })
    expect(conns).toEqual([{ id: "c1", provider: "kiro", name: null, authType: null }])
  })

  it("bỏ qua phần tử thiếu id hoặc provider", () => {
    const conns = normalizeConnections({
      connections: [{ id: "c1" }, { provider: "kiro" }, { id: "c2", provider: "codex" }]
    })
    expect(conns.map((c) => c.id)).toEqual(["c2"])
  })

  it("trả mảng rỗng khi shape lạ", () => {
    expect(normalizeConnections({})).toEqual([])
    expect(normalizeConnections(null)).toEqual([])
  })
})

describe("pendingEntry", () => {
  it("tạo entry pending chưa có dữ liệu", () => {
    const stored = pendingEntry(conn)
    expect(stored.failed).toBe(false)
    expect(stored.entry.status).toBe("pending")
    expect(stored.entry.quotas).toBeNull()
    expect(stored.entry.fetchedAt).toBeNull()
  })
})

describe("applyResult", () => {
  it("kind quotas -> status ok, failed false", () => {
    const stored = applyResult(null, conn, {
      kind: "quotas",
      plan: "Kiro Pro",
      quotas: { credit: { used: 1, total: 2, remaining: 1, resetAt: null, unlimited: false } }
    }, NOW)
    expect(stored.entry.status).toBe("ok")
    expect(stored.entry.plan).toBe("Kiro Pro")
    expect(stored.entry.fetchedAt).toBe(NOW)
    expect(stored.failed).toBe(false)
  })

  it("kind message -> status unavailable, quotas null, giữ message", () => {
    const stored = applyResult(null, conn, {
      kind: "message",
      message: "Usage not available for this connection"
    }, NOW)
    expect(stored.entry.status).toBe("unavailable")
    expect(stored.entry.quotas).toBeNull()
    expect(stored.entry.message).toBe("Usage not available for this connection")
    expect(stored.failed).toBe(false)
  })

  it("kind unauthorized -> status unauthorized, failed true", () => {
    const stored = applyResult(null, conn, { kind: "unauthorized", message: "no" }, NOW)
    expect(stored.entry.status).toBe("unauthorized")
    expect(stored.failed).toBe(true)
  })

  it("kind error giữ nguyên quotas lấy được lần cuối", () => {
    const good = applyResult(null, conn, {
      kind: "quotas",
      plan: "Kiro Pro",
      quotas: { credit: { used: 1, total: 2, remaining: 1, resetAt: null, unlimited: false } }
    }, NOW)

    const later = "2026-08-28T10:20:03.000Z"
    const bad = applyResult(good, conn, { kind: "error", message: "boom" }, later)

    expect(bad.entry.status).toBe("error")
    expect(bad.entry.quotas).toEqual(good.entry.quotas)
    expect(bad.entry.plan).toBe("Kiro Pro")
    expect(bad.entry.message).toBe("boom")
    expect(bad.failed).toBe(true)
    // fetchedAt vẫn là lúc lấy được dữ liệu tốt, không phải lúc lỗi
    expect(bad.entry.fetchedAt).toBe(NOW)
  })

  it("kind error khi chưa từng có dữ liệu tốt thì quotas vẫn null", () => {
    const stored = applyResult(null, conn, { kind: "error", message: "boom" }, NOW)
    expect(stored.entry.quotas).toBeNull()
    expect(stored.entry.fetchedAt).toBeNull()
  })

  it("cập nhật metadata connection mỗi lần apply", () => {
    const prev: StoredEntry = pendingEntry(conn)
    const renamed: Connection = { ...conn, name: "Kiro renamed" }
    const stored = applyResult(prev, renamed, { kind: "message", message: "m" }, NOW)
    expect(stored.entry.name).toBe("Kiro renamed")
  })
})
```

- [ ] **Step 2: Chạy test cho chắc nó fail**

Run: `bun test tests/normalize.test.ts`
Expected: FAIL — không resolve được `../src/normalize`

- [ ] **Step 3: Viết `src/normalize.ts`**

```ts
import type {
  AppliedResult,
  Connection,
  QuotaPool,
  StoredEntry,
  UsageResult
} from "./types"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

/**
 * Tên pool khác nhau theo provider (credit, session, weekly, premium_requests,
 * *_freetrial, …) và registry đổi mỗi bản phát hành. Duyệt key, giữ nguyên tên.
 */
export function normalizePools(raw: unknown): Record<string, QuotaPool> {
  if (!isRecord(raw)) return {}

  const pools: Record<string, QuotaPool> = {}
  for (const [name, value] of Object.entries(raw)) {
    if (!isRecord(value)) continue
    pools[name] = {
      used: numberOrNull(value.used),
      total: numberOrNull(value.total),
      remaining: numberOrNull(value.remaining),
      resetAt: stringOrNull(value.resetAt),
      unlimited: value.unlimited === true
    }
  }
  return pools
}

/**
 * 9Router trả 200 cho cả "có quota" lẫn "không hỗ trợ / lỗi mềm". Không được
 * dựa vào HTTP status — phải kiểm tra sự tồn tại của trường `quotas`.
 */
export function classifyUsageResponse(httpStatus: number, body: unknown): UsageResult {
  if (httpStatus === 404) return { kind: "missing" }

  if (httpStatus === 401) {
    const message = isRecord(body) ? stringOrNull(body.error) : null
    return { kind: "unauthorized", message: message ?? "Refresh credential thất bại" }
  }

  if (httpStatus !== 200) {
    const message = isRecord(body) ? stringOrNull(body.error) : null
    return { kind: "error", message: message ?? `9Router trả HTTP ${httpStatus}` }
  }

  if (isRecord(body) && isRecord(body.quotas)) {
    return {
      kind: "quotas",
      plan: isRecord(body) ? stringOrNull(body.plan) : null,
      quotas: normalizePools(body.quotas)
    }
  }

  const message = isRecord(body) ? stringOrNull(body.message) : null
  return { kind: "message", message: message ?? "9Router không trả quota cho connection này" }
}

export function normalizeConnections(body: unknown): Connection[] {
  if (!isRecord(body) || !Array.isArray(body.connections)) return []

  const out: Connection[] = []
  for (const raw of body.connections) {
    if (!isRecord(raw)) continue
    const id = stringOrNull(raw.id)
    const provider = stringOrNull(raw.provider)
    if (!id || !provider) continue
    out.push({
      id,
      provider,
      name: stringOrNull(raw.name),
      authType: stringOrNull(raw.authType)
    })
  }
  return out
}

export function pendingEntry(conn: Connection): StoredEntry {
  return {
    failed: false,
    entry: {
      connectionId: conn.id,
      provider: conn.provider,
      name: conn.name,
      authType: conn.authType,
      status: "pending",
      plan: null,
      quotas: null,
      message: null,
      fetchedAt: null
    }
  }
}

export function applyResult(
  prev: StoredEntry | null,
  conn: Connection,
  result: AppliedResult,
  nowIso: string
): StoredEntry {
  const base = {
    connectionId: conn.id,
    provider: conn.provider,
    name: conn.name,
    authType: conn.authType
  }

  if (result.kind === "quotas") {
    return {
      failed: false,
      entry: {
        ...base,
        status: "ok",
        plan: result.plan,
        quotas: result.quotas,
        message: null,
        fetchedAt: nowIso
      }
    }
  }

  if (result.kind === "message") {
    return {
      failed: false,
      entry: {
        ...base,
        status: "unavailable",
        plan: null,
        quotas: null,
        message: result.message,
        fetchedAt: nowIso
      }
    }
  }

  // unauthorized và error: giữ nguyên số liệu tốt gần nhất để client vẫn có gì hiển thị.
  return {
    failed: true,
    entry: {
      ...base,
      status: result.kind === "unauthorized" ? "unauthorized" : "error",
      plan: prev?.entry.plan ?? null,
      quotas: prev?.entry.quotas ?? null,
      message: result.message,
      fetchedAt: prev?.entry.fetchedAt ?? null
    }
  }
}
```

- [ ] **Step 4: Chạy test cho chắc nó pass**

Run: `bun test tests/normalize.test.ts`
Expected: PASS, 23 tests

- [ ] **Step 5: Commit**

```bash
git add src/normalize.ts tests/normalize.test.ts
git commit -m "feat: normalize 9router usage responses into a stable shape"
```

---

### Task 5: Snapshot store

**Files:**
- Create: `src/store.ts`
- Test: `tests/store.test.ts`

**Interfaces:**
- Consumes: `src/types.ts`, `src/normalize.ts`
- Produces: `class SnapshotStore` với
  - `constructor(opts: { staleAfterMs: number; now: () => number })`
  - `syncConnections(conns: Connection[]): void`
  - `apply(conn: Connection, result: AppliedResult): void`
  - `remove(id: string): void`
  - `get(id: string): QuotaEntry | null`
  - `list(filter?: { provider?: string; status?: EntryStatus }): QuotaEntry[]`
  - `connections(): Connection[]`
  - `size(): number`
  - `markSweep(): void`
  - `lastSweepAt(): string | null`

- [ ] **Step 1: Viết test thất bại**

Tạo `tests/store.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "bun:test"
import { SnapshotStore } from "../src/store"
import type { Connection } from "../src/types"

const kiro: Connection = { id: "c1", provider: "kiro", name: "Kiro #1", authType: "oauth" }
const codex: Connection = { id: "c2", provider: "codex", name: "Codex", authType: "oauth" }

const okResult = {
  kind: "quotas" as const,
  plan: "Kiro Pro",
  quotas: { credit: { used: 1, total: 2, remaining: 1, resetAt: null, unlimited: false } }
}

let clock = 1_000_000
let store: SnapshotStore

beforeEach(() => {
  clock = 1_000_000
  store = new SnapshotStore({ staleAfterMs: 600_000, now: () => clock })
})

describe("syncConnections", () => {
  it("thêm connection mới ở trạng thái pending", () => {
    store.syncConnections([kiro])
    expect(store.get("c1")?.status).toBe("pending")
    expect(store.size()).toBe(1)
  })

  it("gỡ connection không còn trong danh sách", () => {
    store.syncConnections([kiro, codex])
    store.syncConnections([kiro])
    expect(store.get("c2")).toBeNull()
    expect(store.size()).toBe(1)
  })

  it("không xoá dữ liệu quota của connection còn tồn tại", () => {
    store.syncConnections([kiro])
    store.apply(kiro, okResult)
    store.syncConnections([kiro])
    expect(store.get("c1")?.status).toBe("ok")
  })

  it("cập nhật tên khi connection được đổi tên", () => {
    store.syncConnections([kiro])
    store.apply(kiro, okResult)
    store.syncConnections([{ ...kiro, name: "Đổi tên" }])
    expect(store.get("c1")?.name).toBe("Đổi tên")
  })
})

describe("stale", () => {
  it("false ngay sau khi lấy thành công", () => {
    store.syncConnections([kiro])
    store.apply(kiro, okResult)
    expect(store.get("c1")?.stale).toBe(false)
  })

  it("true khi dữ liệu cũ hơn staleAfterMs", () => {
    store.syncConnections([kiro])
    store.apply(kiro, okResult)
    clock += 600_001
    expect(store.get("c1")?.stale).toBe(true)
  })

  it("true ngay lập tức khi lượt lấy gần nhất thất bại", () => {
    store.syncConnections([kiro])
    store.apply(kiro, okResult)
    store.apply(kiro, { kind: "error", message: "boom" })
    expect(store.get("c1")?.stale).toBe(true)
  })

  it("false với entry pending vì chưa có dữ liệu nào để mà cũ", () => {
    store.syncConnections([kiro])
    clock += 10_000_000
    expect(store.get("c1")?.stale).toBe(false)
  })
})

describe("list", () => {
  beforeEach(() => {
    store.syncConnections([kiro, codex])
    store.apply(kiro, okResult)
    store.apply(codex, { kind: "message", message: "không hỗ trợ" })
  })

  it("trả tất cả khi không lọc", () => {
    expect(store.list().map((e) => e.connectionId).sort()).toEqual(["c1", "c2"])
  })

  it("lọc theo provider", () => {
    expect(store.list({ provider: "kiro" }).map((e) => e.connectionId)).toEqual(["c1"])
  })

  it("lọc theo status", () => {
    expect(store.list({ status: "unavailable" }).map((e) => e.connectionId)).toEqual(["c2"])
  })

  it("lọc kết hợp không khớp thì trả rỗng", () => {
    expect(store.list({ provider: "kiro", status: "unavailable" })).toEqual([])
  })
})

describe("markSweep", () => {
  it("lastSweepAt null trước lần quét đầu", () => {
    expect(store.lastSweepAt()).toBeNull()
  })

  it("ghi lại thời điểm quét gần nhất dạng ISO", () => {
    store.markSweep()
    expect(store.lastSweepAt()).toBe(new Date(clock).toISOString())
  })
})

describe("apply với connection chưa có trong store", () => {
  it("tự thêm entry", () => {
    store.apply(kiro, okResult)
    expect(store.get("c1")?.status).toBe("ok")
  })
})

describe("remove", () => {
  it("gỡ hẳn entry", () => {
    store.syncConnections([kiro])
    store.remove("c1")
    expect(store.get("c1")).toBeNull()
  })
})
```

- [ ] **Step 2: Chạy test cho chắc nó fail**

Run: `bun test tests/store.test.ts`
Expected: FAIL — không resolve được `../src/store`

- [ ] **Step 3: Viết `src/store.ts`**

```ts
import { applyResult, pendingEntry } from "./normalize"
import type {
  AppliedResult,
  Connection,
  EntryStatus,
  QuotaEntry,
  StoredEntry
} from "./types"

export type SnapshotStoreOptions = {
  staleAfterMs: number
  now: () => number
}

export type ListFilter = {
  provider?: string | undefined
  status?: EntryStatus | undefined
}

export class SnapshotStore {
  #entries = new Map<string, StoredEntry>()
  #conns = new Map<string, Connection>()
  #lastSweepAt: string | null = null
  #staleAfterMs: number
  #now: () => number

  constructor(opts: SnapshotStoreOptions) {
    this.#staleAfterMs = opts.staleAfterMs
    this.#now = opts.now
  }

  syncConnections(conns: Connection[]): void {
    const seen = new Set<string>()

    for (const conn of conns) {
      seen.add(conn.id)
      this.#conns.set(conn.id, conn)

      const existing = this.#entries.get(conn.id)
      if (!existing) {
        this.#entries.set(conn.id, pendingEntry(conn))
        continue
      }

      // Giữ nguyên số liệu, chỉ làm tươi metadata.
      existing.entry.provider = conn.provider
      existing.entry.name = conn.name
      existing.entry.authType = conn.authType
    }

    for (const id of [...this.#entries.keys()]) {
      if (!seen.has(id)) this.remove(id)
    }
  }

  apply(conn: Connection, result: AppliedResult): void {
    const prev = this.#entries.get(conn.id) ?? null
    const nowIso = new Date(this.#now()).toISOString()
    this.#conns.set(conn.id, conn)
    this.#entries.set(conn.id, applyResult(prev, conn, result, nowIso))
  }

  remove(id: string): void {
    this.#entries.delete(id)
    this.#conns.delete(id)
  }

  get(id: string): QuotaEntry | null {
    const stored = this.#entries.get(id)
    return stored ? this.#withStale(stored) : null
  }

  list(filter: ListFilter = {}): QuotaEntry[] {
    const out: QuotaEntry[] = []
    for (const stored of this.#entries.values()) {
      if (filter.provider && stored.entry.provider !== filter.provider) continue
      if (filter.status && stored.entry.status !== filter.status) continue
      out.push(this.#withStale(stored))
    }
    return out
  }

  connections(): Connection[] {
    return [...this.#conns.values()]
  }

  size(): number {
    return this.#entries.size
  }

  markSweep(): void {
    this.#lastSweepAt = new Date(this.#now()).toISOString()
  }

  lastSweepAt(): string | null {
    return this.#lastSweepAt
  }

  /**
   * Dùng khi cả vòng quét thất bại (ví dụ không lấy được danh sách connection
   * từ 9Router) — ta không biết trạng thái mới của bất kỳ connection nào, nên
   * chỉ có thể nói dữ liệu đang có là cũ. Số liệu quota và status giữ nguyên,
   * chỉ có `stale` bị ép thành true bất kể tuổi thực của dữ liệu.
   */
  markAllStale(): void {
    for (const stored of this.#entries.values()) {
      stored.failed = true
    }
  }

  #withStale(stored: StoredEntry): QuotaEntry {
    return { ...stored.entry, stale: this.#isStale(stored) }
  }

  #isStale(stored: StoredEntry): boolean {
    if (stored.failed) return true
    // Chưa có dữ liệu thì không có gì để mà cũ.
    if (stored.entry.fetchedAt === null) return false
    const age = this.#now() - Date.parse(stored.entry.fetchedAt)
    return age > this.#staleAfterMs
  }
}
```

**`markAllStale()` không phải suy đoán trước — nó được phát hiện là cần thiết khi
viết test tích hợp ở Task 9**: khi `listConnections()` thất bại hoàn toàn, không
có kết quả nào để `apply()` vào từng connection, nên `stale` (vốn chỉ tính theo
tuổi) không có cách nào tự bật lên. Phần code và test này được thêm vào cùng lúc
với Task 9, nhưng đặt ở đây để `store.ts` giữ nguyên là nơi duy nhất chứa logic
staleness.

- [ ] **Step 4: Chạy test cho chắc nó pass**

Run: `bun test tests/store.test.ts`
Expected: PASS, 19 tests (16 ban đầu + 3 test cho `markAllStale`, xem Task 9)

- [ ] **Step 5: Commit**

```bash
git add src/store.ts tests/store.test.ts
git commit -m "feat: in-memory snapshot store with last-good retention and staleness"
```

---

### Task 6: Hàng đợi tuần tự một worker

Đây là bất biến quan trọng nhất của cả hệ thống: **không bao giờ có hai lời gọi ra 9Router chạy đồng thời.** Test phải khẳng định điều đó trực tiếp, không suy diễn.

**Files:**
- Create: `src/queue.ts`
- Test: `tests/queue.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `type Priority = "high" | "low"`
  - `class SerialQueue` với `constructor(opts: { delayMs: number; sleep?: (ms: number) => Promise<void> })`, `enqueue<T>(key: string, priority: Priority, task: () => Promise<T>): Promise<T>`, `pending(): number`, `stop(): Promise<void>`

- [ ] **Step 1: Viết test thất bại**

Tạo `tests/queue.test.ts`:

```ts
import { describe, expect, it } from "bun:test"
import { SerialQueue } from "../src/queue"

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
```

Lưu ý về test "dedup nâng ưu tiên": job `a` đã nằm trong hàng đợi, nên lần enqueue thứ hai **không** chạy task mới — nó chỉ nâng ưu tiên và chia sẻ kết quả của job đang chờ. Vì thế `a-lần-hai` không bao giờ xuất hiện trong `order`, và `a` chạy trước `b`.

- [ ] **Step 2: Chạy test cho chắc nó fail**

Run: `bun test tests/queue.test.ts`
Expected: FAIL — không resolve được `../src/queue`

- [ ] **Step 3: Viết `src/queue.ts`**

```ts
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
```

- [ ] **Step 4: Chạy test cho chắc nó pass**

Run: `bun test tests/queue.test.ts`
Expected: PASS, 9 tests

- [ ] **Step 5: Commit**

```bash
git add src/queue.ts tests/queue.test.ts
git commit -m "feat: single-worker priority queue with inter-job delay and dedup"
```

---

### Task 7: Client gọi 9Router

**Files:**
- Create: `src/upstream.ts`
- Create: `tests/fixtures/fakeRouter.ts`
- Test: `tests/upstream.test.ts`

**Interfaces:**
- Consumes: `src/types.ts`, `src/normalize.ts`, `src/cliToken.ts` (`TokenProvider`)
- Produces: `class UpstreamClient` với `constructor(opts: { baseUrl: string; timeoutMs: number; tokens: TokenProvider })`, `listConnections(): Promise<Connection[]>`, `fetchUsage(id: string, force?: boolean): Promise<UsageResult>`
- `tests/fixtures/fakeRouter.ts` produces: `startFakeRouter(opts: FakeRouterOptions): Promise<FakeRouter>`

- [ ] **Step 1: Viết fake 9Router dùng chung cho Task 7 và Task 9**

Tạo `tests/fixtures/fakeRouter.ts`:

```ts
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
}

export type FakeRouter = {
  url: string
  /** Mọi request đã nhận, để khẳng định force=1 và header token. */
  calls: Array<{ path: string; query: Record<string, string>; token: string | null }>
  setConnections(value: unknown): void
  setUsage(id: string, value: FakeUsage): void
  stop(): Promise<void>
}

export async function startFakeRouter(opts: FakeRouterOptions = {}): Promise<FakeRouter> {
  let connections: unknown = opts.connections ?? { connections: [] }
  const usage: Record<string, FakeUsage> = { ...(opts.usage ?? {}) }
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
    stop: async () => {
      // force:true đóng cả các kết nối keep-alive đang mở — nếu không, fetch có
      // thể tái dùng socket cũ và vẫn nhận được response từ server "đã dừng",
      // làm sai các test giả lập 9Router sập giữa chừng.
      await app.stop(true)
    }
  }
}
```

- [ ] **Step 2: Viết test thất bại cho `UpstreamClient`**

Tạo `tests/upstream.test.ts`:

```ts
import { afterEach, describe, expect, it } from "bun:test"
import { startFakeRouter, type FakeRouter } from "./fixtures/fakeRouter"
import { UpstreamClient } from "../src/upstream"
import type { TokenProvider } from "../src/cliToken"

const tokens: TokenProvider = {
  get: async () => "abcdef0123456789",
  isReady: () => true
}

let router: FakeRouter | null = null

afterEach(async () => {
  await router?.stop()
  router = null
})

function client(baseUrl: string, timeoutMs = 5_000): UpstreamClient {
  return new UpstreamClient({ baseUrl, timeoutMs, tokens })
}

describe("listConnections", () => {
  it("trả danh sách đã chuẩn hoá", async () => {
    router = await startFakeRouter({
      connections: {
        connections: [
          { id: "c1", provider: "kiro", authType: "oauth", name: "Kiro #1", apiKey: "phải bị bỏ" }
        ]
      }
    })

    const conns = await client(router.url).listConnections()
    expect(conns).toEqual([{ id: "c1", provider: "kiro", name: "Kiro #1", authType: "oauth" }])
  })

  it("gửi header x-9r-cli-token", async () => {
    router = await startFakeRouter({ requireToken: "abcdef0123456789" })
    await client(router.url).listConnections()
    expect(router.calls[0]?.token).toBe("abcdef0123456789")
  })

  it("ném lỗi khi 9Router trả lỗi", async () => {
    router = await startFakeRouter({ requireToken: "token-khac" })
    await expect(client(router.url).listConnections()).rejects.toThrow(/401/)
  })

  it("ném lỗi khi không kết nối được", async () => {
    await expect(client("http://127.0.0.1:1").listConnections()).rejects.toThrow()
  })
})

describe("fetchUsage", () => {
  it("200 có quotas -> kind quotas", async () => {
    router = await startFakeRouter({
      usage: {
        c1: {
          status: 200,
          body: { plan: "Kiro Pro", quotas: { credit: { used: 12.5, total: 50 } } }
        }
      }
    })

    const result = await client(router.url).fetchUsage("c1")
    expect(result.kind).toBe("quotas")
  })

  it("200 có message -> kind message", async () => {
    router = await startFakeRouter({
      usage: { c1: { status: 200, body: { message: "Usage not available for this connection" } } }
    })
    expect((await client(router.url).fetchUsage("c1")).kind).toBe("message")
  })

  it("401 -> kind unauthorized", async () => {
    router = await startFakeRouter({ usage: { c1: { status: 401, body: { error: "Unauthorized" } } } })
    expect((await client(router.url).fetchUsage("c1")).kind).toBe("unauthorized")
  })

  it("404 -> kind missing", async () => {
    router = await startFakeRouter({})
    expect((await client(router.url).fetchUsage("khong-co")).kind).toBe("missing")
  })

  it("500 -> kind error thay vì ném", async () => {
    router = await startFakeRouter({ usage: { c1: { status: 500, body: { error: "boom" } } } })
    expect((await client(router.url).fetchUsage("c1")).kind).toBe("error")
  })

  it("mặc định không gửi force", async () => {
    router = await startFakeRouter({ usage: { c1: { status: 200, body: { quotas: {} } } } })
    await client(router.url).fetchUsage("c1")
    expect(router.calls.at(-1)?.query.force).toBeUndefined()
  })

  it("gửi force=1 khi được yêu cầu", async () => {
    router = await startFakeRouter({ usage: { c1: { status: 200, body: { quotas: {} } } } })
    await client(router.url).fetchUsage("c1", true)
    expect(router.calls.at(-1)?.query.force).toBe("1")
  })

  it("timeout -> kind error, không treo", async () => {
    router = await startFakeRouter({
      usage: { c1: { status: 200, body: { quotas: {} } } },
      delayMs: 200
    })
    const result = await client(router.url, 30).fetchUsage("c1")
    expect(result.kind).toBe("error")
  })

  it("không kết nối được -> kind error", async () => {
    const result = await client("http://127.0.0.1:1").fetchUsage("c1")
    expect(result.kind).toBe("error")
  })
})
```

- [ ] **Step 3: Chạy test cho chắc nó fail**

Run: `bun test tests/upstream.test.ts`
Expected: FAIL — không resolve được `../src/upstream`

- [ ] **Step 4: Viết `src/upstream.ts`**

```ts
import type { TokenProvider } from "./cliToken"
import { classifyUsageResponse, normalizeConnections } from "./normalize"
import type { Connection, UsageResult } from "./types"

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
```

- [ ] **Step 5: Chạy test cho chắc nó pass**

Run: `bun test tests/upstream.test.ts`
Expected: PASS, 14 tests

- [ ] **Step 6: Commit**

```bash
git add src/upstream.ts tests/upstream.test.ts tests/fixtures/fakeRouter.ts
git commit -m "feat: 9router upstream client with timeout and typed results"
```

---

### Task 8: Poller quét định kỳ

**Files:**
- Create: `src/poller.ts`
- Test: `tests/poller.test.ts`

**Interfaces:**
- Consumes: `src/upstream.ts`, `src/store.ts`, `src/queue.ts`, `src/cliToken.ts`
- Produces: `class Poller` với `constructor(deps: PollerDeps)`, `sweep(): Promise<void>`, `refreshOne(connectionId: string, force: boolean): Promise<QuotaEntry | null>`, `start(): void`, `stop(): void`, `upstreamHealthy(): boolean`

`sweep()` nạp job **ưu tiên thấp**, không dùng `force`. `refreshOne()` nạp job **ưu tiên cao** và chờ kết quả.

- [ ] **Step 1: Viết test thất bại**

Tạo `tests/poller.test.ts`:

```ts
import { afterEach, describe, expect, it } from "bun:test"
import { startFakeRouter, type FakeRouter } from "./fixtures/fakeRouter"
import { Poller } from "../src/poller"
import { SerialQueue } from "../src/queue"
import { SnapshotStore } from "../src/store"
import { UpstreamClient } from "../src/upstream"
import type { TokenProvider } from "../src/cliToken"

const tokens: TokenProvider = {
  get: async () => "abcdef0123456789",
  isReady: () => true
}

let router: FakeRouter | null = null
let queue: SerialQueue | null = null

afterEach(async () => {
  await queue?.stop()
  queue = null
  await router?.stop()
  router = null
})

function build(url: string) {
  const store = new SnapshotStore({ staleAfterMs: 600_000, now: () => Date.now() })
  queue = new SerialQueue({ delayMs: 0 })
  const upstream = new UpstreamClient({ baseUrl: url, timeoutMs: 2_000, tokens })
  const poller = new Poller({ upstream, store, queue, intervalMs: 60_000 })
  return { store, poller }
}

const twoConnections = {
  connections: [
    { id: "c1", provider: "kiro", authType: "oauth", name: "Kiro #1" },
    { id: "c2", provider: "codex", authType: "oauth", name: "Codex" }
  ]
}

describe("sweep", () => {
  it("nạp snapshot cho mọi connection", async () => {
    router = await startFakeRouter({
      connections: twoConnections,
      usage: {
        c1: { status: 200, body: { plan: "Kiro Pro", quotas: { credit: { used: 1, total: 2 } } } },
        c2: { status: 200, body: { message: "Usage not available for this connection" } }
      }
    })

    const { store, poller } = build(router.url)
    await poller.sweep()

    expect(store.get("c1")?.status).toBe("ok")
    expect(store.get("c2")?.status).toBe("unavailable")
    expect(store.lastSweepAt()).not.toBeNull()
  })

  it("không bao giờ gửi force trong vòng quét nền", async () => {
    router = await startFakeRouter({
      connections: twoConnections,
      usage: {
        c1: { status: 200, body: { quotas: {} } },
        c2: { status: 200, body: { quotas: {} } }
      }
    })

    const { poller } = build(router.url)
    await poller.sweep()

    const usageCalls = router.calls.filter((c) => c.path.startsWith("/api/usage/"))
    expect(usageCalls.length).toBe(2)
    expect(usageCalls.every((c) => c.query.force === undefined)).toBe(true)
  })

  it("gỡ connection khi 9Router trả 404", async () => {
    router = await startFakeRouter({
      connections: twoConnections,
      usage: { c1: { status: 200, body: { quotas: {} } } }
    })

    const { store, poller } = build(router.url)
    await poller.sweep()

    expect(store.get("c1")?.status).toBe("ok")
    expect(store.get("c2")).toBeNull()
  })

  it("một connection lỗi không làm hỏng cả vòng quét", async () => {
    router = await startFakeRouter({
      connections: twoConnections,
      usage: {
        c1: { status: 500, body: { error: "boom" } },
        c2: { status: 200, body: { quotas: { credit: { used: 1 } } } }
      }
    })

    const { store, poller } = build(router.url)
    await poller.sweep()

    expect(store.get("c1")?.status).toBe("error")
    expect(store.get("c2")?.status).toBe("ok")
  })

  it("giữ snapshot cũ và báo upstream không khoẻ khi 9Router sập", async () => {
    router = await startFakeRouter({
      connections: twoConnections,
      usage: { c1: { status: 200, body: { quotas: { credit: { used: 1 } } } } }
    })

    const { store, poller } = build(router.url)
    await poller.sweep()
    expect(poller.upstreamHealthy()).toBe(true)

    await router.stop()
    router = null
    await poller.sweep()

    expect(poller.upstreamHealthy()).toBe(false)
    expect(store.get("c1")?.status).toBe("ok")
    expect(store.get("c1")?.quotas).not.toBeNull()
  })
})

describe("refreshOne", () => {
  it("trả entry mới nhất", async () => {
    router = await startFakeRouter({
      connections: twoConnections,
      usage: { c1: { status: 200, body: { quotas: { credit: { used: 1 } } } } }
    })

    const { poller } = build(router.url)
    await poller.sweep()

    router.setUsage("c1", { status: 200, body: { quotas: { credit: { used: 9 } } } })
    const entry = await poller.refreshOne("c1", false)

    expect(entry?.quotas?.credit?.used).toBe(9)
  })

  it("gửi force=1 khi được yêu cầu", async () => {
    router = await startFakeRouter({
      connections: twoConnections,
      usage: { c1: { status: 200, body: { quotas: {} } } }
    })

    const { poller } = build(router.url)
    await poller.sweep()
    await poller.refreshOne("c1", true)

    expect(router.calls.at(-1)?.query.force).toBe("1")
  })

  it("trả null khi connection không có trong snapshot", async () => {
    router = await startFakeRouter({ connections: { connections: [] } })
    const { poller } = build(router.url)
    await poller.sweep()
    expect(await poller.refreshOne("khong-co", false)).toBeNull()
  })
})
```

- [ ] **Step 2: Chạy test cho chắc nó fail**

Run: `bun test tests/poller.test.ts`
Expected: FAIL — không resolve được `../src/poller`

- [ ] **Step 3: Viết `src/poller.ts`**

```ts
import type { SerialQueue } from "./queue"
import type { SnapshotStore } from "./store"
import type { UpstreamClient } from "./upstream"
import type { Connection, QuotaEntry } from "./types"

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
```

**`store.markAllStale()` và try/catch quanh vòng lặp per-connection cũng được
phát hiện là cần thiết ở Task 9**, cùng lý do với `markAllStale()` trong
`store.ts`: test tích hợp mô phỏng 9Router sập giữa chừng lộ ra rằng (a) không
có cách nào tự bật `stale` khi `listConnections()` thất bại, và (b) nếu hàng đợi
từ chối job giữa lúc `sweep()` đang chạy nền (ví dụ `queue.stop()` gọi trong lúc
`POST /refresh`'s `void sweep()` còn dở dang), lỗi đó văng thành unhandled
rejection thay vì được một connection khác "hấp thụ". Code trên đã có sẵn cả hai
fix.

- [ ] **Step 4: Chạy test cho chắc nó pass**

Run: `bun test tests/poller.test.ts`
Expected: PASS, 8 tests

- [ ] **Step 5: Commit**

```bash
git add src/poller.ts tests/poller.test.ts
git commit -m "feat: background poller sweeping all connections through the queue"
```

---

### Task 9: HTTP server Elysia

**Files:**
- Create: `src/server.ts`
- Test: `tests/server.test.ts`

**Interfaces:**
- Consumes: `src/config.ts`, `src/store.ts`, `src/poller.ts`, `src/cliToken.ts`
- Produces: `createServer(deps: ServerDeps): Elysia` — trả app chưa `listen`, để test gọi `app.handle(request)` trực tiếp

- [ ] **Step 1: Viết test thất bại**

Tạo `tests/server.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { startFakeRouter, type FakeRouter } from "./fixtures/fakeRouter"
import { createServer } from "../src/server"
import { Poller } from "../src/poller"
import { SerialQueue } from "../src/queue"
import { SnapshotStore } from "../src/store"
import { UpstreamClient } from "../src/upstream"
import { loadConfig } from "../src/config"
import type { TokenProvider } from "../src/cliToken"

const API_KEY = "test-api-key"

let router: FakeRouter | null = null
let queue: SerialQueue | null = null
// Không import kiểu Elysia trần: mỗi .macro()/.get()/.post() tích luỹ thêm
// generic riêng, nên gán ngược vào Elysia trần làm tsc báo lỗi assignability.
let app: ReturnType<typeof createServer> | null = null
let store: SnapshotStore
let poller: Poller
let clock: number
let tokenReady: boolean

const tokens: TokenProvider = {
  get: async () => {
    if (!tokenReady) throw new Error("chưa có machine-id")
    return "abcdef0123456789"
  },
  isReady: () => tokenReady
}

const twoConnections = {
  connections: [
    { id: "c1", provider: "kiro", authType: "oauth", name: "Kiro #1" },
    { id: "c2", provider: "codex", authType: "oauth", name: "Codex" }
  ]
}

async function boot(usage: Record<string, { status: 200 | 401 | 404 | 500; body: unknown }>) {
  router = await startFakeRouter({ connections: twoConnections, usage })
  clock = 1_000_000
  tokenReady = true
  store = new SnapshotStore({ staleAfterMs: 600_000, now: () => clock })
  queue = new SerialQueue({ delayMs: 0 })
  const upstream = new UpstreamClient({ baseUrl: router.url, timeoutMs: 2_000, tokens })
  poller = new Poller({ upstream, store, queue, intervalMs: 60_000 })
  const config = loadConfig({ API_KEY, REFRESH_COOLDOWN_MS: "60000" })
  app = createServer({ config, store, poller, tokens, now: () => clock })
  await poller.sweep()
}

function req(path: string, init: RequestInit = {}): Request {
  return new Request(`http://localhost${path}`, init)
}

function authed(path: string, init: RequestInit = {}): Request {
  return req(path, { ...init, headers: { ...(init.headers ?? {}), "x-api-key": API_KEY } })
}

beforeEach(() => {
  tokenReady = true
})

afterEach(async () => {
  await queue?.stop()
  queue = null
  await router?.stop()
  router = null
  app = null
})

describe("xác thực", () => {
  beforeEach(async () => {
    await boot({ c1: { status: 200, body: { quotas: { credit: { used: 1 } } } } })
  })

  it("/quotas không có key -> 401", async () => {
    const res = await app!.handle(req("/quotas"))
    expect(res.status).toBe(401)
  })

  it("/quotas sai key -> 401", async () => {
    const res = await app!.handle(req("/quotas", { headers: { "x-api-key": "sai" } }))
    expect(res.status).toBe(401)
  })

  it("/quotas đúng key -> 200", async () => {
    const res = await app!.handle(authed("/quotas"))
    expect(res.status).toBe(200)
  })

  it("/health không cần key", async () => {
    const res = await app!.handle(req("/health"))
    expect(res.status).toBe(200)
  })

  it("/health không lộ CLI token hay API key", async () => {
    const res = await app!.handle(req("/health"))
    const text = await res.text()
    expect(text).not.toContain("abcdef0123456789")
    expect(text).not.toContain(API_KEY)
  })
})

describe("GET /quotas", () => {
  beforeEach(async () => {
    await boot({
      c1: { status: 200, body: { plan: "Kiro Pro", quotas: { credit: { used: 1, total: 2 } } } },
      c2: { status: 200, body: { message: "Usage not available for this connection" } }
    })
  })

  it("trả mọi entry", async () => {
    const body = (await (await app!.handle(authed("/quotas"))).json()) as any
    expect(body.entries.length).toBe(2)
    expect(body.count).toBe(2)
  })

  it("lọc theo provider", async () => {
    const body = (await (await app!.handle(authed("/quotas?provider=kiro"))).json()) as any
    expect(body.entries.map((e: any) => e.connectionId)).toEqual(["c1"])
  })

  it("lọc theo status", async () => {
    const body = (await (await app!.handle(authed("/quotas?status=unavailable"))).json()) as any
    expect(body.entries.map((e: any) => e.connectionId)).toEqual(["c2"])
  })

  it("status không hợp lệ -> 400", async () => {
    const res = await app!.handle(authed("/quotas?status=nonsense"))
    expect(res.status).toBe(400)
  })

  it("giữ nguyên tên pool của provider", async () => {
    const body = (await (await app!.handle(authed("/quotas?provider=kiro"))).json()) as any
    expect(Object.keys(body.entries[0].quotas)).toEqual(["credit"])
  })
})

describe("GET /quotas/:id", () => {
  beforeEach(async () => {
    await boot({ c1: { status: 200, body: { quotas: { credit: { used: 1 } } } } })
  })

  it("trả đúng entry", async () => {
    const body = (await (await app!.handle(authed("/quotas/c1"))).json()) as any
    expect(body.connectionId).toBe("c1")
  })

  it("id lạ -> 404", async () => {
    const res = await app!.handle(authed("/quotas/khong-co"))
    expect(res.status).toBe(404)
  })
})

describe("POST /refresh", () => {
  beforeEach(async () => {
    await boot({
      c1: { status: 200, body: { quotas: { credit: { used: 1 } } } },
      c2: { status: 200, body: { quotas: { credit: { used: 2 } } } }
    })
  })

  it("trả 202 ngay, không chờ quét xong", async () => {
    const res = await app!.handle(authed("/refresh", { method: "POST" }))
    expect(res.status).toBe(202)
  })
})

describe("POST /refresh/:id", () => {
  beforeEach(async () => {
    await boot({ c1: { status: 200, body: { quotas: { credit: { used: 1 } } } } })
  })

  it("trả entry mới nhất", async () => {
    router!.setUsage("c1", { status: 200, body: { quotas: { credit: { used: 9 } } } })
    const body = (await (await app!.handle(authed("/refresh/c1", { method: "POST" }))).json()) as any
    expect(body.quotas.credit.used).toBe(9)
  })

  it("gọi lần hai trong cooldown -> 429 kèm retryAfter", async () => {
    await app!.handle(authed("/refresh/c1", { method: "POST" }))
    const res = await app!.handle(authed("/refresh/c1", { method: "POST" }))
    expect(res.status).toBe(429)
    const body = (await res.json()) as any
    expect(body.retryAfter).toBeGreaterThan(0)
  })

  it("hết cooldown thì gọi lại được", async () => {
    await app!.handle(authed("/refresh/c1", { method: "POST" }))
    clock += 60_001
    const res = await app!.handle(authed("/refresh/c1", { method: "POST" }))
    expect(res.status).toBe(200)
  })

  it("id lạ -> 404", async () => {
    const res = await app!.handle(authed("/refresh/khong-co", { method: "POST" }))
    expect(res.status).toBe(404)
  })

  it("force=1 được chuyển xuống upstream", async () => {
    await app!.handle(authed("/refresh/c1?force=1", { method: "POST" }))
    expect(router!.calls.at(-1)?.query.force).toBe("1")
  })
})

describe("khi chưa có CLI token", () => {
  beforeEach(async () => {
    await boot({ c1: { status: 200, body: { quotas: { credit: { used: 1 } } } } })
    tokenReady = false
  })

  it("/quotas -> 503 kèm hướng dẫn", async () => {
    const res = await app!.handle(authed("/quotas"))
    expect(res.status).toBe(503)
    const body = (await res.json()) as any
    expect(body.error).toMatch(/9Router/)
  })

  it("/health -> tokenReady false, ok false", async () => {
    const body = (await (await app!.handle(req("/health"))).json()) as any
    expect(body.tokenReady).toBe(false)
    expect(body.ok).toBe(false)
  })
})

describe("khi 9Router sập", () => {
  it("vẫn trả snapshot cũ với stale true", async () => {
    await boot({ c1: { status: 200, body: { quotas: { credit: { used: 1 } } } } })
    await router!.stop()
    router = null
    await poller.sweep()

    const body = (await (await app!.handle(authed("/quotas/c1"))).json()) as any
    expect(body.quotas.credit.used).toBe(1)
    expect(body.stale).toBe(true)

    const health = (await (await app!.handle(req("/health"))).json()) as any
    expect(health.upstream).toBe("down")
  })
})
```

- [ ] **Step 2: Chạy test cho chắc nó fail**

Run: `bun test tests/server.test.ts`
Expected: FAIL — không resolve được `../src/server`

- [ ] **Step 3: Viết `src/server.ts`**

```ts
import { Elysia } from "elysia"
import { timingSafeEqual } from "node:crypto"
import type { Config } from "./config"
import type { TokenProvider } from "./cliToken"
import type { Poller } from "./poller"
import type { SnapshotStore } from "./store"
import { isEntryStatus } from "./types"

export type ServerDeps = {
  config: Config
  store: SnapshotStore
  poller: Poller
  tokens: TokenProvider
  now: () => number
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8")
  const right = Buffer.from(b, "utf8")
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

const TOKEN_HINT =
  "Chưa đọc được CLI token. Hãy chạy 9Router một lần để nó sinh machine-id và auth/cli-secret."

// Không khai kiểu trả về tường minh — lý do tương tự phía test: kiểu tích luỹ
// qua các lệnh .macro()/.get()/.post() phức tạp hơn kiểu Elysia trần có thể
// biểu diễn được. Để TypeScript tự suy luận, và nơi tiêu thụ dùng
// ReturnType<typeof createServer>.
export function createServer(deps: ServerDeps) {
  const { config, store, poller, tokens, now } = deps
  const lastRefreshAt = new Map<string, number>()

  return new Elysia()
    .macro({
      apiKey: {
        resolve({ headers, status }) {
          const provided = headers["x-api-key"]
          if (typeof provided !== "string" || !safeEqual(provided, config.apiKey)) {
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

    .get("/health", () => ({
      ok: tokens.isReady() && poller.upstreamHealthy(),
      upstream: poller.upstreamHealthy() ? "up" : "down",
      tokenReady: tokens.isReady(),
      hint: tokens.isReady() ? null : TOKEN_HINT,
      connections: store.size(),
      lastSweepAt: store.lastSweepAt()
    }))

    .get(
      "/quotas",
      ({ query, status }) => {
        const wanted = query.status
        if (wanted !== undefined && !isEntryStatus(wanted)) {
          return status(400, { error: `status không hợp lệ: ${wanted}` })
        }
        const entries = store.list({ provider: query.provider, status: wanted })
        return { count: entries.length, lastSweepAt: store.lastSweepAt(), entries }
      },
      { apiKey: true, needsToken: true }
    )

    .get(
      "/quotas/:id",
      ({ params, status }) => {
        const entry = store.get(params.id)
        if (!entry) return status(404, { error: `Không có connection ${params.id}` })
        return entry
      },
      { apiKey: true, needsToken: true }
    )

    .post(
      "/refresh",
      ({ status }) => {
        void poller.sweep()
        return status(202, { accepted: true, connections: store.size() })
      },
      { apiKey: true, needsToken: true }
    )

    .post(
      "/refresh/:id",
      async ({ params, query, status }) => {
        if (!store.get(params.id)) {
          return status(404, { error: `Không có connection ${params.id}` })
        }

        const last = lastRefreshAt.get(params.id)
        const elapsed = last === undefined ? Infinity : now() - last
        if (elapsed < config.refreshCooldownMs) {
          const retryAfter = Math.ceil((config.refreshCooldownMs - elapsed) / 1000)
          return status(429, { error: "Đang trong cooldown refresh", retryAfter })
        }

        lastRefreshAt.set(params.id, now())
        const entry = await poller.refreshOne(params.id, query.force === "1")
        if (!entry) return status(404, { error: `Không có connection ${params.id}` })
        return entry
      },
      { apiKey: true, needsToken: true }
    )
}
```

- [ ] **Step 4: Chạy test cho chắc nó pass**

Run: `bun test tests/server.test.ts`
Expected: PASS, 21 tests

- [ ] **Step 5: Commit**

```bash
git add src/server.ts tests/server.test.ts
git commit -m "feat: elysia http surface with api-key guard, filters and refresh cooldown"
```

---

### Task 10: Ghép mọi thứ và tài liệu vận hành

**Files:**
- Create: `src/index.ts`
- Create: `.env.example`
- Create: `README.md`
- Test: `tests/smoke.test.ts`

**Interfaces:**
- Consumes: tất cả module trước
- Produces: `bootstrap(env: Record<string, string | undefined>): Promise<{ stop: () => Promise<void>; port: number }>`

- [ ] **Step 1: Viết test thất bại cho bootstrap**

Tạo `tests/smoke.test.ts`:

```ts
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
```

- [ ] **Step 2: Chạy test cho chắc nó fail**

Run: `bun test tests/smoke.test.ts`
Expected: FAIL — `bootstrap` chưa tồn tại

- [ ] **Step 3: Viết `src/index.ts`**

```ts
import { createTokenProvider, resolveDataDirFromEnv } from "./cliToken"
import { loadConfig } from "./config"
import { Poller } from "./poller"
import { SerialQueue } from "./queue"
import { createServer } from "./server"
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
    onError: (message) => console.warn(`[poller] ${message}`)
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

  const app = createServer({ config, store, poller, tokens, now: () => Date.now() })
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
```

- [ ] **Step 4: Chạy test cho chắc nó pass**

Run: `bun test tests/smoke.test.ts`
Expected: PASS, 2 tests

- [ ] **Step 5: Viết `.env.example`**

```
# Bắt buộc. Service bên ngoài phải gửi giá trị này ở header x-api-key.
API_KEY=doi-gia-tri-nay

# Cổng và interface của chính server này.
PORT=20129
HOST=0.0.0.0

# 9Router đang chạy ở đâu.
UPSTREAM_URL=http://localhost:20128

# Bỏ trống để tự giải: %APPDATA%\9router trên Windows, ~/.9router ở nơi khác.
# DATA_DIR=

# Chu kỳ quét nền. Đừng hạ quá thấp: mỗi lượt lấy quota khiến 9Router
# refresh credential và ghi token mới vào DB của nó.
POLL_INTERVAL_MS=300000

# Nghỉ giữa hai lời gọi liên tiếp ra 9Router.
REQUEST_DELAY_MS=1500

# Cooldown của POST /refresh/:id, tính riêng cho từng connection.
REFRESH_COOLDOWN_MS=60000

UPSTREAM_TIMEOUT_MS=20000
```

- [ ] **Step 6: Viết `README.md`**

````markdown
# 9Router Quota Server

Mini HTTP server chạy cùng máy với 9Router, expose quota của mọi connection cho
service bên ngoài.

## Vì sao cần nó

9Router không có endpoint lấy quota hàng loạt: phải `GET /api/providers` rồi gọi
`GET /api/usage/{id}` cho từng connection. Xác thực lại cần CLI token, mà token
chỉ tính được trên chính máy chạy 9Router. Và gọi song song nhiều account rất dễ
khiến provider rate-limit.

Server này gom cả ba việc đó vào một chỗ: quét nền tuần tự có delay, giữ snapshot
trong RAM, phục vụ client bằng một API duy nhất.

## Chạy

```bash
bun install
cp .env.example .env   # rồi đổi API_KEY
bun run start
```

Yêu cầu: 9Router đã chạy ít nhất một lần trên máy này, để nó sinh
`<DATA_DIR>/machine-id` và `<DATA_DIR>/auth/cli-secret`.

## API

Mọi endpoint trừ `/health` cần header `x-api-key`.

| Method | Path | Mô tả |
|---|---|---|
| GET | `/health` | Trạng thái vận hành, không cần auth |
| GET | `/quotas` | Toàn bộ snapshot; lọc `?provider=`, `?status=` |
| GET | `/quotas/:id` | Một connection |
| POST | `/refresh` | Quét lại tất cả, trả `202` ngay |
| POST | `/refresh/:id` | Quét lại một connection, chờ kết quả; `?force=1` bỏ qua cache 9Router |

```bash
curl -H "x-api-key: $API_KEY" http://localhost:20129/quotas
```

### Trường `status` của mỗi entry

| Giá trị | Ý nghĩa |
|---|---|
| `ok` | Có số liệu quota |
| `unavailable` | 9Router trả 200 kèm `message` — connection không hỗ trợ quota, hoặc lỗi mềm phía provider. Đọc `message` |
| `unauthorized` | Cần authorize lại connection trong dashboard 9Router |
| `error` | Lỗi khi lấy. `quotas` giữ số liệu tốt gần nhất nếu từng có, `stale` bật |
| `pending` | Vừa thấy connection, chưa quét lần nào |

Tên các pool trong `quotas` khác nhau theo provider (`credit`, `session`,
`weekly`, `premium_requests`, …). **Đừng hardcode — hãy duyệt key.**

## Lưu ý vận hành

Quota không được lưu xuống đĩa. Restart là mất, giống chính 9Router. Muốn có
chuỗi thời gian thì phía bạn phải tự lưu.

`force=1` bỏ qua cache của 9Router. Endpoint quota OAuth của Anthropic sẽ trả 429
và bị khoá cooldown 180s. Chỉ dùng khi người dùng bấm refresh thủ công.

`API_KEY` bảo vệ một server nắm CLI token có toàn quyền dashboard 9Router. Đặt
giá trị mạnh, và đừng expose ra Internet công cộng.

## Test

```bash
bun test
```
````

- [ ] **Step 7: Chạy toàn bộ test**

Run: `bun test`
Expected: PASS toàn bộ, khoảng 101 test qua 8 file

- [ ] **Step 8: Chạy thử thật**

```bash
API_KEY=dev-key bun run start
```

Expected: in ra địa chỉ lắng nghe và `DATA_DIR`. Nếu 9Router đang chạy,
`curl -H "x-api-key: dev-key" http://localhost:20129/health` trả `ok:true` sau
vòng quét đầu tiên. Nếu chưa có `machine-id`, server in cảnh báo về token nhưng
vẫn lên, và `/health` trả `tokenReady:false` kèm hướng dẫn — đúng thiết kế,
không phải lỗi.

- [ ] **Step 9: Commit**

```bash
git add src/index.ts .env.example README.md tests/smoke.test.ts
git commit -m "feat: wire server together with graceful shutdown and operator docs"
```

---

## Self-Review

**Spec coverage:**

| Mục spec | Task |
|---|---|
| §2 Stack Bun + Elysia | 1 |
| §3.2 Chín module | 1–10 |
| §4.1 Giải DATA_DIR, luật `/` trên Windows | 3 (không test riêng, theo yêu cầu) |
| §4.2 Công thức token, trim, 16 hex | 3, kiểm end-to-end ở smoke test Task 10 |
| §4.3 Không log/lộ token | 9 (test `/health` không lộ token) |
| §5 Bảng endpoint, bind, `x-api-key`, constant-time | 9 |
| §5.1 Shape entry, không hardcode pool | 4, 9 |
| §5.2 Ánh xạ sáu nhánh trạng thái | 4, 8 |
| §5.3 `force=1` chỉ ở refresh một connection, có cooldown | 8, 9 |
| §5.4 Poll nền không dùng force | 8 |
| §6 Bảng cấu hình đầy đủ | 2, 10 |
| §7 Thiếu API_KEY thoát; thiếu token vẫn chạy; upstream sập giữ last-good; một connection lỗi không hỏng cả vòng; định nghĩa `stale`; graceful shutdown | 2, 5, 8, 9, 10 |
| §8 Ba tầng test | 2–10 |
| §9 `normalize.ts` là lớp cách ly duy nhất | 4 |

Không có mục spec nào thiếu task.

**Placeholder scan:** không có TBD/TODO; mọi step code đều có nội dung thật; mọi
test đều có assertion cụ thể.

**Type consistency:** `StoredEntry` (Task 1) được `pendingEntry`/`applyResult`
(Task 4) tạo ra và `SnapshotStore` (Task 5) tiêu thụ. `AppliedResult` loại bỏ
`missing`, và cả `Poller` (Task 8) lẫn `SnapshotStore.apply` đều tôn trọng: nhánh
`missing` gọi `store.remove()` chứ không gọi `apply()`. `TokenProvider` (Task 3)
được `UpstreamClient` (Task 7) và `createServer` (Task 9) dùng đúng ba method
`get`/`isReady`. `SerialQueue.enqueue(key, priority, task)` giữ nguyên
thứ tự tham số ở mọi nơi gọi.
