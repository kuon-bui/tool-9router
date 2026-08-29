# Bề mặt MCP cho Quota Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cho phép model lấy quota của mọi connection 9Router qua MCP (Streamable HTTP tại `/mcp`), đứng trên đúng `quotaService` mà HTTP API đang dùng — không có đường riêng ra 9Router. Kèm theo: chuyển toàn bộ schema HTTP API từ TypeBox sang zod, để repo chỉ còn một hệ schema.

**Architecture:** `src/mcp/` là một mặt tiền protocol thuần tuý, không có state và không có nghiệp vụ riêng — nó gọi `quotaService` (đã tồn tại) giống hệt `src/http/quotas.ts` và `src/http/refresh.ts`. `@modelcontextprotocol/server` v2's `createMcpHandler` dựng một `McpServer` mới cho mỗi request (mô hình per-request, không session), nhận thẳng `Request` chuẩn Web và trả `Response`, nên gắn được vào Elysia bằng một route `.all("/mcp", ...)` duy nhất. `src/http/guards.ts` được nhấc ra `src/guards/` để cả `http/` lẫn `mcp/` cùng dùng mà không tạo vòng import.

**Tech Stack:** Bun, Elysia 1.4.30, TypeScript, `bun:test`, zod `^4.2.0`, `@modelcontextprotocol/server` `2.0.0` (pin chính xác).

**Spec:** `docs/superpowers/specs/2026-08-29-mcp-quota-surface-design.md`

## Global Constraints

- Transport: chỉ Streamable HTTP tại `/mcp`, stateless (không session, không `Mcp-Session-Id`). Không làm stdio.
- `@modelcontextprotocol/server` pin **chính xác** `"2.0.0"` (không `^`). `zod` ở dải `"^4.2.0"` — khớp dải mà SDK khai báo, để bun giải về một bản zod duy nhất.
- Ba tool: `list_quotas`, `get_quota`, `refresh_quota`. Không có tool phân tích/xếp hạng, không có resources, không có prompts.
- `refresh_quota` gọi `quotaService.refreshOne(id, false)` — **`force` không xuất hiện trong input schema dưới bất kỳ hình thức nào**, không phải mặc định `false`.
- Kết quả tool chỉ có `content` dạng text (Markdown). Không `structuredContent`, không `outputSchema`.
- MCP không được import `SnapshotStore` hay `Poller` trực tiếp — chỉ qua interface hẹp của `quotaService` (`list`, `get`, `refreshOne`).
- Guard `apiKey` chấp nhận **cả** header `x-api-key` **và** `Authorization: Bearer <API_KEY>`. Áp dụng cho toàn bộ server, không riêng `/mcp`.
- Không thêm biến môi trường mới, không thêm cờ bật/tắt MCP.
- `src/config.ts` không đổi.
- Sau khi chuyển `src/http/schemas.ts` sang zod, `tests/http/server.test.ts` phải xanh **không sửa một dòng nào**.
- Mọi văn xuôi hiển thị cho người dùng (mô tả tool, thông báo lỗi, README) viết bằng tiếng Việt, đúng giọng văn hiện có trong repo.
- `tsconfig.json` có `noUncheckedIndexedAccess: true` — code mới phải biên dịch sạch dưới cờ này.

---

### Task 1: Thêm dependency — zod và MCP SDK

**Files:**
- Modify: `package.json`
- Modify: `bun.lock`

**Interfaces:**
- Consumes: nothing
- Produces: `zod` (`^4.2.0`) và `@modelcontextprotocol/server` (`2.0.0` chính xác) khả dụng cho mọi task sau

- [ ] **Step 1: Cài zod**

```bash
bun add zod@^4.2.0
```

- [ ] **Step 2: Cài MCP SDK, pin chính xác — không dùng `^`**

```bash
bun add --exact @modelcontextprotocol/server@2.0.0
```

- [ ] **Step 3: Xác nhận `package.json` ghi đúng hai dòng này**

```bash
grep -A5 '"dependencies"' package.json
```

Expected: thấy đúng
```json
"@modelcontextprotocol/server": "2.0.0",
"elysia": "^1.3.0",
"zod": "^4.2.0"
```
(`elysia` giữ nguyên dòng cũ — không đổi.)

- [ ] **Step 4: Xác nhận chỉ có MỘT bản zod được giải trong cây dependency**

```bash
bun pm ls --all | grep -i zod
```

Expected: đúng một dòng `zod@4.x.x`. Nếu thấy hai dòng với số bản khác nhau, dừng lại — đây là lỗi khó chẩn đoán mà spec (`docs/superpowers/specs/2026-08-29-mcp-quota-surface-design.md` §11) đã cảnh báo: hai bản zod cùng tồn tại khiến schema dựng bởi bản này không được bản kia nhận.

- [ ] **Step 5: Chạy lại toàn bộ test hiện có — thêm dependency không được làm hỏng gì**

```bash
bun test
```

Expected: PASS, số lượng test không đổi so với trước khi thêm dependency.

- [ ] **Step 6: Commit**

```bash
git add package.json bun.lock
git commit -m "chore: add zod and pin @modelcontextprotocol/server@2.0.0"
```

---

### Task 2: Nhấc `guards` ra khỏi `http` thành miền riêng

**Files:**
- Create: `src/guards/index.ts`
- Delete: `src/http/guards.ts`
- Modify: `src/http/quotas.ts`
- Modify: `src/http/refresh.ts`
- Modify: `src/http/health.ts`

**Interfaces:**
- Consumes: `Config` (từ `../config`), `TokenProvider` (từ `../auth`) — không đổi so với hiện tại
- Produces: `createGuards(deps: GuardDeps)`, `type GuardDeps`, `safeEqual`, `TOKEN_HINT` — cùng tên, cùng chữ ký như cũ, chỉ đổi đường dẫn import từ `./guards` (trong `http/`) thành `../guards` (từ `http/`) hoặc `./guards` → `../guards`

Đây là refactor cơ học, không đổi hành vi. `src/guards/` nằm cùng cấp với `src/http/`, nên nội dung file giữ nguyên y hệt — chỉ đường dẫn `import` ở ba nơi gọi nó thay đổi.

- [ ] **Step 1: Tạo `src/guards/index.ts` với đúng nội dung của `src/http/guards.ts` hiện tại**

```ts
import { Elysia } from "elysia"
import { timingSafeEqual } from "node:crypto"
import type { Config } from "../config"
import type { TokenProvider } from "../auth"

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8")
  const right = Buffer.from(b, "utf8")
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

export const TOKEN_HINT =
  "Chưa đọc được CLI token. Hãy chạy 9Router một lần để nó sinh machine-id và auth/cli-secret."

export type GuardDeps = {
  config: Config
  tokens: TokenProvider
}

/**
 * Hai macro dùng chung cho mọi route trừ /health: `apiKey` xác thực service
 * bên ngoài, `needsToken` chặn khi chưa đọc được CLI token của 9Router.
 */
export function createGuards({ config, tokens }: GuardDeps) {
  return new Elysia().macro({
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
}
```

- [ ] **Step 2: Xoá `src/http/guards.ts`**

```bash
rm src/http/guards.ts
```

- [ ] **Step 3: Sửa import trong `src/http/quotas.ts`**

Tìm dòng:
```ts
import { createGuards, type GuardDeps } from "./guards"
```
Thay bằng:
```ts
import { createGuards, type GuardDeps } from "../guards"
```

- [ ] **Step 4: Sửa import trong `src/http/refresh.ts`** — cùng thay đổi hệt Step 3

Tìm dòng:
```ts
import { createGuards, type GuardDeps } from "./guards"
```
Thay bằng:
```ts
import { createGuards, type GuardDeps } from "../guards"
```

- [ ] **Step 5: Sửa import trong `src/http/health.ts`**

Tìm dòng:
```ts
import { TOKEN_HINT } from "./guards"
```
Thay bằng:
```ts
import { TOKEN_HINT } from "../guards"
```

- [ ] **Step 6: Chạy toàn bộ test — phải xanh không cần sửa gì trong `tests/`**

```bash
bun test
```

Expected: PASS, số test giữ nguyên như Task 1 Step 5. Đây là refactor thuần vị trí file — nếu có test đỏ, đó là import path sai, không phải hành vi cần sửa.

- [ ] **Step 7: Commit**

```bash
git add -A src/guards src/http/guards.ts src/http/quotas.ts src/http/refresh.ts src/http/health.ts
git commit -m "refactor: move guards out of http/ into its own domain"
```

---

### Task 3: Guard `apiKey` chấp nhận thêm `Authorization: Bearer`

**Files:**
- Modify: `src/guards/index.ts`
- Modify: `tests/http/server.test.ts`

**Interfaces:**
- Consumes: `GuardDeps` (không đổi)
- Produces: macro `apiKey` chấp nhận key qua `x-api-key` **hoặc** `Authorization: Bearer <key>`; ưu tiên `x-api-key` nếu cả hai cùng có mặt

- [ ] **Step 1: Viết test thất bại — thêm vào cuối `describe("xác thực", ...)` trong `tests/http/server.test.ts`**

Tìm khối:
```ts
  it("/health không lộ CLI token hay API key", async () => {
    const res = await app!.handle(req("/health"))
    const text = await res.text()
    expect(text).not.toContain("abcdef0123456789")
    expect(text).not.toContain(API_KEY)
  })
})
```

Thay bằng (thêm hai test mới trước dấu đóng `})`):
```ts
  it("/health không lộ CLI token hay API key", async () => {
    const res = await app!.handle(req("/health"))
    const text = await res.text()
    expect(text).not.toContain("abcdef0123456789")
    expect(text).not.toContain(API_KEY)
  })

  it("/quotas với Authorization: Bearer đúng key -> 200", async () => {
    const res = await app!.handle(
      req("/quotas", { headers: { authorization: `Bearer ${API_KEY}` } })
    )
    expect(res.status).toBe(200)
  })

  it("/quotas với Authorization: Bearer sai key -> 401", async () => {
    const res = await app!.handle(
      req("/quotas", { headers: { authorization: "Bearer sai-key" } })
    )
    expect(res.status).toBe(401)
  })
})
```

- [ ] **Step 2: Chạy để xác nhận hai test mới thất bại**

```bash
bun test tests/http/server.test.ts
```

Expected: FAIL — test "Authorization: Bearer đúng key -> 200" nhận 401 thay vì 200 (macro hiện tại chỉ đọc `x-api-key`).

- [ ] **Step 3: Sửa macro `apiKey` trong `src/guards/index.ts`**

Tìm:
```ts
export function createGuards({ config, tokens }: GuardDeps) {
  return new Elysia().macro({
    apiKey: {
      resolve({ headers, status }) {
        const provided = headers["x-api-key"]
        if (typeof provided !== "string" || !safeEqual(provided, config.apiKey)) {
          return status(401, { error: "Unauthorized" })
        }
        return {}
      }
    },
```

Thay bằng:
```ts
/**
 * Nhận key qua `x-api-key` hoặc `Authorization: Bearer <key>` — nhiều client
 * MCP chỉ cho điền một ô token duy nhất và tự đặt nó vào Authorization.
 */
function extractApiKey(headers: Record<string, string | undefined>): string | null {
  const direct = headers["x-api-key"]
  if (typeof direct === "string") return direct

  const auth = headers["authorization"]
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    return auth.slice("Bearer ".length)
  }

  return null
}

export function createGuards({ config, tokens }: GuardDeps) {
  return new Elysia().macro({
    apiKey: {
      resolve({ headers, status }) {
        const provided = extractApiKey(headers)
        if (provided === null || !safeEqual(provided, config.apiKey)) {
          return status(401, { error: "Unauthorized" })
        }
        return {}
      }
    },
```

- [ ] **Step 4: Chạy lại để xác nhận xanh**

```bash
bun test tests/http/server.test.ts
```

Expected: PASS, toàn bộ test trong file kể cả hai test mới.

- [ ] **Step 5: Chạy toàn bộ suite**

```bash
bun test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/guards/index.ts tests/http/server.test.ts
git commit -m "feat: accept Authorization Bearer alongside x-api-key"
```

---

### Task 4: Chuyển `src/http/schemas.ts` từ TypeBox sang zod

**Files:**
- Modify: `src/http/schemas.ts`
- Create: `tests/http/schemas.test.ts`

**Interfaces:**
- Consumes: `ENTRY_STATUSES` (từ `../types`)
- Produces: cùng tên export như cũ (`errorSchema`, `cooldownErrorSchema`, `quotaEntrySchema`, `quotaListSchema`, `healthSchema`, `refreshAcceptedSchema`), giờ là schema zod thay vì TypeBox — dùng trực tiếp trong `response: {...}` của Elysia y hệt trước

**Điều kiện nghiệm thu (từ spec §9.1): `tests/http/server.test.ts` phải xanh mà KHÔNG sửa một dòng nào trong file đó.**

- [ ] **Step 1: Viết test mới trước — `tests/http/schemas.test.ts`**

```ts
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
```

- [ ] **Step 2: Chạy để xác nhận thất bại (schema hiện tại là TypeBox, import từ `schemas.ts` vẫn hoạt động nhưng ta cần chắc test này tồn tại và phản ánh đúng hành vi trước khi đổi)**

```bash
bun test tests/http/schemas.test.ts
```

Expected: PASS ngay cả trước khi đổi — vì TypeBox cũng chặn sai shape với 422. Đây không phải bug; mục đích của bước này là có sẵn bài kiểm chứng trước khi đổi triển khai, để Step 4 chứng minh hành vi không đổi qua zod. Ghi nhận PASS rồi tiếp tục.

- [ ] **Step 3: Viết lại toàn bộ `src/http/schemas.ts` bằng zod**

```ts
import { z } from "zod"
import { ENTRY_STATUSES } from "../types"

export const errorSchema = z.object({
  error: z.string()
})

export const cooldownErrorSchema = z.object({
  error: z.string(),
  retryAfter: z.number()
})

const entryStatusSchema = z.enum(ENTRY_STATUSES)

/** Tên pool khác nhau theo provider — schema chỉ ràng buộc hình dạng của MỘT pool. */
const quotaPoolSchema = z.object({
  used: z.number().nullable(),
  total: z.number().nullable(),
  remaining: z.number().nullable(),
  resetAt: z.string().nullable(),
  unlimited: z.boolean()
})

export const quotaEntrySchema = z.object({
  connectionId: z.string(),
  provider: z.string(),
  name: z.string().nullable(),
  authType: z.string().nullable(),
  status: entryStatusSchema,
  plan: z.string().nullable(),
  quotas: z.record(z.string(), quotaPoolSchema).nullable(),
  message: z.string().nullable(),
  fetchedAt: z.string().nullable(),
  stale: z.boolean()
})

export const quotaListSchema = z.object({
  count: z.number(),
  lastSweepAt: z.string().nullable(),
  entries: z.array(quotaEntrySchema)
})

export const healthSchema = z.object({
  ok: z.boolean(),
  upstream: z.enum(["up", "down"]),
  tokenReady: z.boolean(),
  hint: z.string().nullable(),
  connections: z.number(),
  lastSweepAt: z.string().nullable()
})

export const refreshAcceptedSchema = z.object({
  accepted: z.literal(true),
  connections: z.number()
})
```

- [ ] **Step 4: Xác nhận `tests/http/server.test.ts` xanh KHÔNG SỬA GÌ trong file đó**

```bash
git diff --stat tests/http/server.test.ts
```

Expected: không có output (không có thay đổi nào trong file này kể từ Task 3 Step 6).

```bash
bun test tests/http/server.test.ts
```

Expected: PASS, toàn bộ test.

- [ ] **Step 5: Xác nhận `tests/http/schemas.test.ts` vẫn xanh với schema mới**

```bash
bun test tests/http/schemas.test.ts
```

Expected: PASS.

- [ ] **Step 6: Xác nhận không còn `t` của TypeBox nào được import trong `src/`**

```bash
grep -rn 'import { t }' src
grep -rn 'from "elysia"' src | grep -v '^src/guards\|^src/http/health.ts\|^src/http/index.ts\|^src/http/quotas.ts\|^src/http/refresh.ts\|^src/http/schemas.ts\|^src/http/quotaService.ts\|fixtures'
```

Expected: dòng đầu không có output. Dòng hai chỉ để soát bằng mắt — mọi `import { Elysia }` là bình thường, không import `t`.

- [ ] **Step 7: Chạy toàn bộ suite**

```bash
bun test
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/http/schemas.ts tests/http/schemas.test.ts
git commit -m "refactor: convert http response schemas from TypeBox to zod"
```

---

### Task 5: `src/mcp/format.ts` — QuotaEntry[] → Markdown

**Files:**
- Create: `src/mcp/format.ts`
- Test: `tests/mcp/format.test.ts`

**Interfaces:**
- Consumes: `QuotaEntry`, `EntryStatus` (từ `../types`) — không phụ thuộc gì khác, không phụ thuộc MCP SDK
- Produces:
  - `formatQuotaList(entries: QuotaEntry[], meta: { lastSweepAt: string | null; filter?: { provider?: string | undefined; status?: string | undefined } }): string`
  - `formatSingleEntry(entry: QuotaEntry): string`
  - `formatRefreshedEntry(entry: QuotaEntry): string`

- [ ] **Step 1: Viết test thất bại — `tests/mcp/format.test.ts`**

```ts
import { describe, expect, it } from "bun:test"
import { formatQuotaList, formatRefreshedEntry, formatSingleEntry } from "../../src/mcp/format"
import type { QuotaEntry } from "../../src/types"

function entry(overrides: Partial<QuotaEntry> = {}): QuotaEntry {
  return {
    connectionId: "c1",
    provider: "kiro",
    name: "Kiro #1",
    authType: "oauth",
    status: "ok",
    plan: "Kiro Pro",
    quotas: {
      credit: { used: 25, total: 100, remaining: 75, resetAt: "2026-09-01T00:00:00.000Z", unlimited: false }
    },
    message: null,
    fetchedAt: "2026-08-29T09:00:00.000Z",
    stale: false,
    ...overrides
  }
}

describe("formatSingleEntry", () => {
  it("in tên provider, tên connection, id và trạng thái", () => {
    const text = formatSingleEntry(entry())
    expect(text).toContain("kiro")
    expect(text).toContain("Kiro #1")
    expect(text).toContain("c1")
    expect(text).toContain("ok")
  })

  it("in thanh tiến trình và phần trăm đã dùng, không phải còn lại", () => {
    const text = formatSingleEntry(entry())
    expect(text).toContain("25%")
    expect(text).toContain("25 / 100")
    expect(text).toContain("còn 75")
  })

  it("unlimited: true in vô cực, không in thanh hay %", () => {
    const text = formatSingleEntry(
      entry({ quotas: { credit: { used: 5, total: null, remaining: null, resetAt: null, unlimited: true } } })
    )
    expect(text).toContain("∞")
    expect(text).not.toContain("%")
  })

  it("total là null: bỏ thanh và %, vẫn in used nếu có", () => {
    const text = formatSingleEntry(
      entry({ quotas: { session: { used: 10, total: null, remaining: null, resetAt: null, unlimited: false } } })
    )
    expect(text).not.toContain("%")
    expect(text).not.toContain("█")
    expect(text).toContain("10")
  })

  it("total là 0: bỏ thanh và %", () => {
    const text = formatSingleEntry(
      entry({ quotas: { weekly: { used: 0, total: 0, remaining: 0, resetAt: null, unlimited: false } } })
    )
    expect(text).not.toContain("%")
    expect(text).not.toContain("█")
  })

  it("used là null: bỏ thanh và %, vẫn in total/remaining nếu có", () => {
    const text = formatSingleEntry(
      entry({ quotas: { credit: { used: null, total: 50, remaining: 50, resetAt: null, unlimited: false } } })
    )
    expect(text).not.toContain("%")
    expect(text).toContain("còn 50")
  })

  it("stale: true thêm nhãn số liệu cũ", () => {
    const text = formatSingleEntry(entry({ stale: true }))
    expect(text).toContain("số liệu cũ")
  })

  it("stale: false không thêm nhãn", () => {
    const text = formatSingleEntry(entry({ stale: false }))
    expect(text).not.toContain("số liệu cũ")
  })

  it("status khác ok: in message, không in bảng pool", () => {
    const text = formatSingleEntry(
      entry({ status: "unauthorized", quotas: null, message: "Cần authorize lại." })
    )
    expect(text).toContain("Cần authorize lại.")
    expect(text).not.toContain("█")
  })

  it("quotas là object rỗng: in message thay vì bảng trống", () => {
    const text = formatSingleEntry(entry({ quotas: {}, message: "Không có số liệu." }))
    expect(text).toContain("Không có số liệu.")
  })

  it("pool không có field nào có giá trị: không in dòng trống", () => {
    const text = formatSingleEntry(
      entry({ quotas: { odd: { used: null, total: null, remaining: null, resetAt: null, unlimited: false } } })
    )
    expect(text.trim().length).toBeGreaterThan(0)
    expect(text).toContain("odd")
  })
})

describe("formatQuotaList", () => {
  it("in số lượng connection và thời điểm snapshot", () => {
    const text = formatQuotaList([entry()], { lastSweepAt: "2026-08-29T09:00:00.000Z" })
    expect(text).toContain("1 connection")
    expect(text).toContain("2026-08-29T09:00:00.000Z")
  })

  it("danh sách rỗng không do lọc: nêu chưa có gì, không nhắc bộ lọc", () => {
    const text = formatQuotaList([], { lastSweepAt: null })
    expect(text.toLowerCase()).toContain("không có")
  })

  it("danh sách rỗng do lọc: nêu rõ đã lọc theo gì", () => {
    const text = formatQuotaList([], { lastSweepAt: "x", filter: { provider: "codex" } })
    expect(text).toContain("provider=codex")
  })
})

describe("formatRefreshedEntry", () => {
  it("thêm dòng xác nhận thời điểm làm tươi trước nội dung entry", () => {
    const text = formatRefreshedEntry(entry())
    expect(text).toContain("Vừa làm tươi")
    expect(text).toContain("2026-08-29T09:00:00.000Z")
    expect(text).toContain("kiro")
  })
})
```

- [ ] **Step 2: Chạy để xác nhận thất bại**

```bash
bun test tests/mcp/format.test.ts
```

Expected: FAIL với `Cannot find module '../../src/mcp/format'` (file chưa tồn tại).

- [ ] **Step 3: Viết `src/mcp/format.ts`**

```ts
import type { EntryStatus, QuotaEntry, QuotaPool } from "../types"

const STATUS_ICON: Record<EntryStatus, string> = {
  ok: "✅",
  unavailable: "➖",
  unauthorized: "⛔",
  error: "❌",
  pending: "⏱"
}

const BAR_WIDTH = 16

function formatPool(name: string, pool: QuotaPool): string {
  if (pool.unlimited) {
    return `\`${name}\`  ∞`
  }

  const parts: string[] = []

  if (pool.used !== null && pool.total !== null && pool.total > 0) {
    const fraction = pool.used / pool.total
    const filled = Math.min(BAR_WIDTH, Math.max(0, Math.floor(fraction * BAR_WIDTH)))
    const bar = "█".repeat(filled) + "░".repeat(BAR_WIDTH - filled)
    const percent = Math.round(fraction * 100)
    parts.push(`${bar}  ${percent}%`)
  }

  if (pool.used !== null && pool.total !== null) {
    parts.push(`${pool.used} / ${pool.total}`)
  } else if (pool.used !== null) {
    parts.push(`đã dùng ${pool.used}`)
  } else if (pool.total !== null) {
    parts.push(`tổng ${pool.total}`)
  }

  if (pool.remaining !== null) {
    parts.push(`còn ${pool.remaining}`)
  }

  if (pool.resetAt !== null) {
    parts.push(`reset \`${pool.resetAt}\``)
  }

  // Phòng trường hợp cả bốn field đều null và không unlimited — chưa từng thấy
  // thực tế, nhưng đừng để lọt ra một dòng trống không nói gì.
  if (parts.length === 0) return `\`${name}\`  (không có số liệu)`

  return `\`${name}\`  ${parts.join("  ·  ")}`
}

function formatEntry(entry: QuotaEntry): string {
  const icon = STATUS_ICON[entry.status]
  const staleTag = entry.stale ? "  ⏳ số liệu cũ" : ""
  const header =
    `### ${entry.provider} · ${entry.name ?? entry.connectionId} \`${entry.connectionId}\`` +
    `  ${icon} ${entry.status}${staleTag}`

  if (entry.status !== "ok" || !entry.quotas || Object.keys(entry.quotas).length === 0) {
    const message = entry.message ?? "Không có số liệu quota cho connection này."
    return `${header}\n${message}`
  }

  const pools = Object.entries(entry.quotas).map(([name, pool]) => formatPool(name, pool))
  return `${header}\n${pools.join("\n")}`
}

export type QuotaListMeta = {
  lastSweepAt: string | null
  filter?: { provider?: string | undefined; status?: string | undefined }
}

export function formatQuotaList(entries: QuotaEntry[], meta: QuotaListMeta): string {
  if (entries.length === 0) {
    const filters: string[] = []
    if (meta.filter?.provider) filters.push(`provider=${meta.filter.provider}`)
    if (meta.filter?.status) filters.push(`status=${meta.filter.status}`)
    const filterText = filters.length > 0 ? ` (đã lọc theo ${filters.join(", ")})` : ""
    return `Không có connection nào khớp${filterText}. Thử bỏ bộ lọc hoặc kiểm tra lại 9Router.`
  }

  const sweepText = meta.lastSweepAt
    ? `snapshot lúc \`${meta.lastSweepAt}\``
    : "chưa có vòng quét nào hoàn tất"
  const header = `**${entries.length} connection** · ${sweepText}`

  return [header, ...entries.map(formatEntry)].join("\n\n")
}

export function formatSingleEntry(entry: QuotaEntry): string {
  return formatEntry(entry)
}

export function formatRefreshedEntry(entry: QuotaEntry): string {
  const when = entry.fetchedAt ? `\`${entry.fetchedAt}\`` : "không rõ thời điểm"
  return `Vừa làm tươi lúc ${when}.\n\n${formatEntry(entry)}`
}
```

- [ ] **Step 4: Chạy lại để xác nhận xanh**

```bash
bun test tests/mcp/format.test.ts
```

Expected: PASS, toàn bộ test.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/format.ts tests/mcp/format.test.ts
git commit -m "feat: add Markdown formatter for MCP quota results"
```

---

### Task 6: `src/mcp/tools.ts` — schema input và handler nghiệp vụ

**Files:**
- Create: `src/mcp/tools.ts`
- Test: `tests/mcp/tools.test.ts`

**Interfaces:**
- Consumes:
  - `formatQuotaList`, `formatSingleEntry`, `formatRefreshedEntry` (từ `./format`, Task 5)
  - `QuotaEntry`, `EntryStatus`, `ENTRY_STATUSES` (từ `../types`)
  - `CallToolResult` (type, từ `@modelcontextprotocol/server`)
- Produces:
  - `listQuotasInputSchema`, `getQuotaInputSchema`, `refreshQuotaInputSchema` (zod schema, dùng lại ở Task 7)
  - `type McpToolsDeps` — interface hẹp, **không** import từ `src/http/`, chỉ phụ thuộc `../types`
  - `createMcpTools(deps: McpToolsDeps) => { listQuotas, getQuota, refreshQuota }`

`McpToolsDeps` khai báo interface của `quotaService` bằng tay thay vì import type `QuotaService` từ `src/http/quotaService.ts`. Lý do: `src/http/index.ts` (Task 7) sẽ import `createMcpRoutes` từ `../mcp`, nên nếu `mcp/tools.ts` import ngược một type cụ thể từ `../http/quotaService`, đó là một cross-domain import trỏ thẳng vào file thay vì qua barrel — đúng kiểu vi phạm mà Task 2 vừa sửa cho guards. Định nghĩa lại interface hẹp ở đây (chỉ 3 method thực dùng) tránh hẳn câu hỏi đó: `mcp/` chỉ phụ thuộc `../types`, đúng bất biến "MCP không biết `quotaService` sống ở đâu" của spec §3.1. Vì TypeScript dùng structural typing, `QuotaService` thật (từ `createQuotaService`) tự động khớp interface này — không cần ép kiểu ở nơi gọi.

- [ ] **Step 1: Viết test thất bại — `tests/mcp/tools.test.ts`**

```ts
import { describe, expect, it } from "bun:test"
import { createMcpTools, type McpToolsDeps } from "../../src/mcp/tools"
import type { QuotaEntry } from "../../src/types"

const okEntry: QuotaEntry = {
  connectionId: "c1",
  provider: "kiro",
  name: "Kiro #1",
  authType: "oauth",
  status: "ok",
  plan: "Kiro Pro",
  quotas: { credit: { used: 1, total: 2, remaining: 1, resetAt: null, unlimited: false } },
  message: null,
  fetchedAt: "2026-08-29T09:00:00.000Z",
  stale: false
}

function fakeService(overrides: Partial<McpToolsDeps["quotaService"]> = {}): McpToolsDeps["quotaService"] {
  return {
    list: overrides.list ?? (() => ({ count: 1, lastSweepAt: "2026-08-29T09:00:00.000Z", entries: [okEntry] })),
    get: overrides.get ?? ((id: string) => (id === "c1" ? okEntry : null)),
    refreshOne: overrides.refreshOne ?? (async () => ({ kind: "ok" as const, entry: okEntry }))
  }
}

function firstText(result: { content: Array<{ type: string; text?: string }> }): string {
  const block = result.content[0]
  if (!block || block.type !== "text" || typeof block.text !== "string") {
    throw new Error("content[0] không phải text block")
  }
  return block.text
}

describe("listQuotas", () => {
  it("chuyển filter xuống quotaService và trả text có tên connection", () => {
    let receivedFilter: unknown = null
    const service = fakeService({
      list: (filter) => {
        receivedFilter = filter
        return { count: 1, lastSweepAt: null, entries: [okEntry] }
      }
    })
    const tools = createMcpTools({ quotaService: service })

    const result = tools.listQuotas({ provider: "kiro", status: "ok" })

    expect(receivedFilter).toEqual({ provider: "kiro", status: "ok" })
    expect(result.isError).toBeUndefined()
    expect(firstText(result)).toContain("kiro")
  })
})

describe("getQuota", () => {
  it("trả text khi tìm thấy", () => {
    const tools = createMcpTools({ quotaService: fakeService() })
    const result = tools.getQuota({ connection_id: "c1" })
    expect(result.isError).toBeUndefined()
    expect(firstText(result)).toContain("c1")
  })

  it("trả isError khi không tìm thấy, gợi ý list_quotas", () => {
    const tools = createMcpTools({ quotaService: fakeService() })
    const result = tools.getQuota({ connection_id: "khong-co" })
    expect(result.isError).toBe(true)
    expect(firstText(result)).toContain("list_quotas")
  })
})

describe("refreshQuota", () => {
  it("gọi refreshOne với force=false luôn luôn", async () => {
    let receivedForce: boolean | null = null
    const service = fakeService({
      refreshOne: async (id, force) => {
        receivedForce = force
        return { kind: "ok" as const, entry: okEntry }
      }
    })
    const tools = createMcpTools({ quotaService: service })

    await tools.refreshQuota({ connection_id: "c1" })

    expect(receivedForce).toBe(false)
  })

  it("trả isError kèm connection_id khi notFound", async () => {
    const service = fakeService({ refreshOne: async () => ({ kind: "notFound" as const }) })
    const tools = createMcpTools({ quotaService: service })

    const result = await tools.refreshQuota({ connection_id: "khong-co" })

    expect(result.isError).toBe(true)
    expect(firstText(result)).toContain("khong-co")
  })

  it("trả isError kèm số giây khi đang cooldown", async () => {
    const service = fakeService({
      refreshOne: async () => ({ kind: "cooldown" as const, retryAfterSeconds: 42 })
    })
    const tools = createMcpTools({ quotaService: service })

    const result = await tools.refreshQuota({ connection_id: "c1" })

    expect(result.isError).toBe(true)
    expect(firstText(result)).toContain("42")
  })

  it("trả text xác nhận thời điểm làm tươi khi ok", async () => {
    const tools = createMcpTools({ quotaService: fakeService() })
    const result = await tools.refreshQuota({ connection_id: "c1" })
    expect(result.isError).toBeUndefined()
    expect(firstText(result)).toContain("2026-08-29T09:00:00.000Z")
  })
})
```

- [ ] **Step 2: Chạy để xác nhận thất bại**

```bash
bun test tests/mcp/tools.test.ts
```

Expected: FAIL với `Cannot find module '../../src/mcp/tools'`.

- [ ] **Step 3: Viết `src/mcp/tools.ts`**

```ts
import { z } from "zod"
import type { CallToolResult } from "@modelcontextprotocol/server"
import { ENTRY_STATUSES } from "../types"
import type { EntryStatus, QuotaEntry } from "../types"
import { formatQuotaList, formatRefreshedEntry, formatSingleEntry } from "./format"

export type McpToolsDeps = {
  quotaService: {
    list(filter: { provider?: string | undefined; status?: EntryStatus | undefined }): {
      count: number
      lastSweepAt: string | null
      entries: QuotaEntry[]
    }
    get(id: string): QuotaEntry | null
    refreshOne(
      id: string,
      force: boolean
    ): Promise<
      | { kind: "ok"; entry: QuotaEntry }
      | { kind: "notFound" }
      | { kind: "cooldown"; retryAfterSeconds: number }
    >
  }
}

export const listQuotasInputSchema = z.object({
  provider: z.string().optional(),
  status: z.enum(ENTRY_STATUSES).optional()
})

export const getQuotaInputSchema = z.object({
  connection_id: z.string().min(1)
})

export const refreshQuotaInputSchema = z.object({
  connection_id: z.string().min(1)
})

function textResult(text: string, isError = false): CallToolResult {
  return isError ? { content: [{ type: "text", text }], isError: true } : { content: [{ type: "text", text }] }
}

function notFoundResult(connectionId: string): CallToolResult {
  return textResult(
    `Không có connection nào với id "${connectionId}". Gọi list_quotas để xem danh sách hợp lệ.`,
    true
  )
}

export function createMcpTools(deps: McpToolsDeps) {
  const { quotaService } = deps

  return {
    listQuotas(input: z.infer<typeof listQuotasInputSchema>): CallToolResult {
      const result = quotaService.list({ provider: input.provider, status: input.status })
      const text = formatQuotaList(result.entries, {
        lastSweepAt: result.lastSweepAt,
        filter: { provider: input.provider, status: input.status }
      })
      return textResult(text)
    },

    getQuota(input: z.infer<typeof getQuotaInputSchema>): CallToolResult {
      const entry = quotaService.get(input.connection_id)
      if (!entry) return notFoundResult(input.connection_id)
      return textResult(formatSingleEntry(entry))
    },

    async refreshQuota(input: z.infer<typeof refreshQuotaInputSchema>): Promise<CallToolResult> {
      const outcome = await quotaService.refreshOne(input.connection_id, false)

      switch (outcome.kind) {
        case "notFound":
          return notFoundResult(input.connection_id)
        case "cooldown":
          return textResult(
            `Connection này vừa được làm tươi gần đây. Thử lại sau ${outcome.retryAfterSeconds} giây — đừng gọi lại ngay.`,
            true
          )
        case "ok":
          return textResult(formatRefreshedEntry(outcome.entry))
      }
    }
  }
}

export type McpTools = ReturnType<typeof createMcpTools>
```

- [ ] **Step 4: Chạy lại để xác nhận xanh**

```bash
bun test tests/mcp/tools.test.ts
```

Expected: PASS, toàn bộ test.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/tools.ts tests/mcp/tools.test.ts
git commit -m "feat: add MCP tool schemas and handlers over quotaService"
```

---

### Task 7: `src/mcp/server.ts` + `src/mcp/index.ts` — gắn vào Elysia

**Files:**
- Create: `src/mcp/server.ts`
- Create: `src/mcp/index.ts`
- Modify: `src/http/index.ts`
- Test: `tests/mcp/server.test.ts`

**Interfaces:**
- Consumes:
  - `createMcpTools`, `listQuotasInputSchema`, `getQuotaInputSchema`, `refreshQuotaInputSchema`, `type McpToolsDeps` (từ `./tools`, Task 6)
  - `createGuards`, `type GuardDeps` (từ `../guards`, Task 2)
  - `McpServer`, `createMcpHandler` (từ `@modelcontextprotocol/server`)
- Produces:
  - `buildMcpServer(deps: McpToolsDeps): McpServer` (`server.ts`)
  - `createMcpRoutes(deps: McpRouteDeps)` trả về một `Elysia` instance mount tại `/mcp` (`index.ts`), `type McpRouteDeps = GuardDeps & McpToolsDeps`
  - `src/http/index.ts` mount thêm route này vào server chính

**Ghi chú kỹ thuật quan trọng** (đã xác nhận bằng thực nghiệm khi viết plan, không phải suy từ tài liệu): response của `createMcpHandler` luôn ở dạng SSE-framed (`event: message\ndata: {...}\n\n`) dù chỉ là một request/response đơn, kể cả khi không dùng session — test phải parse theo khuôn đó, không dùng `res.json()`. Client bắt buộc gửi header `Accept: application/json, text/event-stream`, thiếu là nhận `406`. Input sai schema bị SDK tự chặn và trả `isError: true` kèm thông báo do zod sinh ra — handler không cần tự validate lại. `GET /mcp` tự động nhận `405` từ chính SDK (chế độ per-request/stateless chỉ phục vụ `POST`) — không cần Elysia tự chặn GET, cứ mount bằng `.all()` và để SDK quyết định theo đúng ngữ nghĩa protocol. Không có `Mcp-Session-Id` nào từng xuất hiện — model per-request của SDK v2 vốn đã stateless, không cần cấu hình gì thêm để đạt được điều đó.

`handler.close()` (dọn các exchange "modern" còn dang dở) **không được gọi ở đường tắt máy** trong plan này: vì `GET /mcp` luôn 405 nên không bao giờ có SSE stream nào được giữ mở, và mỗi `tools/call` là một round-trip trọn vẹn trong một `await handler.fetch(request)` — không có gì thực sự "dang dở" để đóng khi `app.stop()` được gọi. Nếu sau này thiết kế đổi sang cho phép GET/SSE, đây là chỗ phải quay lại nối `handler.close()` vào `RunningServer.stop()` trong `src/index.ts`.

- [ ] **Step 1: Viết test thất bại — `tests/mcp/server.test.ts`**

```ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { startFakeRouter, type FakeRouter } from "../fixtures/fakeRouter"
import { createServer } from "../../src/http"
import { Poller } from "../../src/poller"
import { SerialQueue } from "../../src/queue"
import { SnapshotStore } from "../../src/store"
import { UpstreamClient } from "../../src/upstream"
import { loadConfig } from "../../src/config"
import type { TokenProvider } from "../../src/auth"

const API_KEY = "test-mcp-key"

let router: FakeRouter | null = null
let queue: SerialQueue | null = null
let app: ReturnType<typeof createServer> | null = null

const tokens: TokenProvider = {
  get: async () => "abcdef0123456789",
  isReady: () => true
}

async function boot() {
  router = await startFakeRouter({
    connections: { connections: [{ id: "c1", provider: "kiro", authType: "oauth", name: "Kiro #1" }] },
    usage: { c1: { status: 200, body: { plan: "Kiro Pro", quotas: { credit: { used: 1, total: 2 } } } } }
  })
  const store = new SnapshotStore({ staleAfterMs: 600_000, now: () => Date.now() })
  queue = new SerialQueue({ delayMs: 0 })
  const upstream = new UpstreamClient({ baseUrl: router.url, timeoutMs: 2_000, tokens })
  const poller = new Poller({ upstream, store, queue, intervalMs: 60_000 })
  const config = loadConfig({ API_KEY, REFRESH_COOLDOWN_MS: "60000" })
  app = createServer({ config, store, poller, tokens, now: () => Date.now() })
  await poller.sweep()
}

beforeEach(async () => {
  await boot()
})

afterEach(async () => {
  await queue?.stop()
  queue = null
  await router?.stop()
  router = null
  app = null
})

function parseSseJson(text: string): any {
  const line = text.split("\n").find((l) => l.startsWith("data: "))
  if (!line) throw new Error(`Không tìm thấy dòng "data:" trong body SSE:\n${text}`)
  return JSON.parse(line.slice("data: ".length))
}

let nextId = 1
function rpc(method: string, params?: unknown, headers: Record<string, string> = {}): Request {
  const id = nextId++
  return new Request("http://localhost/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "x-api-key": API_KEY,
      ...headers
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params })
  })
}

describe("xác thực /mcp", () => {
  it("thiếu key -> 401", async () => {
    const req = new Request("http://localhost/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
    })
    const res = await app!.handle(req)
    expect(res.status).toBe(401)
  })

  it("sai key -> 401", async () => {
    const res = await app!.handle(rpc("tools/list", undefined, { "x-api-key": "sai" }))
    expect(res.status).toBe(401)
  })

  it("Authorization: Bearer đúng key -> 200", async () => {
    const req = new Request("http://localhost/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${API_KEY}`
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
    })
    const res = await app!.handle(req)
    expect(res.status).toBe(200)
  })
})

describe("giao thức JSON-RPC", () => {
  it("initialize trả protocolVersion và serverInfo", async () => {
    const res = await app!.handle(
      rpc("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "0.0.1" }
      })
    )
    expect(res.status).toBe(200)
    const body = parseSseJson(await res.text())
    expect(body.result.serverInfo.name).toBe("9router-quota-server")
  })

  it("tools/list liệt kê đúng 3 tool và KHÔNG có tham số force ở refresh_quota", async () => {
    const res = await app!.handle(rpc("tools/list"))
    const body = parseSseJson(await res.text())
    const names = body.result.tools.map((t: any) => t.name).sort()
    expect(names).toEqual(["get_quota", "list_quotas", "refresh_quota"])

    const refreshTool = body.result.tools.find((t: any) => t.name === "refresh_quota")
    const props = refreshTool.inputSchema.properties ?? {}
    expect(Object.keys(props)).not.toContain("force")
  })

  it("tools/call list_quotas trả text có tên connection", async () => {
    const res = await app!.handle(rpc("tools/call", { name: "list_quotas", arguments: {} }))
    const body = parseSseJson(await res.text())
    expect(body.result.content[0].text).toContain("kiro")
  })

  it("tools/call get_quota với id không tồn tại trả isError", async () => {
    const res = await app!.handle(
      rpc("tools/call", { name: "get_quota", arguments: { connection_id: "khong-co" } })
    )
    const body = parseSseJson(await res.text())
    expect(body.result.isError).toBe(true)
  })

  it("tools/call refresh_quota trả entry vừa làm tươi", async () => {
    const res = await app!.handle(
      rpc("tools/call", { name: "refresh_quota", arguments: { connection_id: "c1" } })
    )
    const body = parseSseJson(await res.text())
    expect(body.result.isError).toBeUndefined()
    expect(body.result.content[0].text).toContain("Vừa làm tươi")
  })
})
```

- [ ] **Step 2: Chạy để xác nhận thất bại**

```bash
bun test tests/mcp/server.test.ts
```

Expected: FAIL — `createServer` chưa mount `/mcp`, mọi request tới đó nhận 404 thay vì các mã mong đợi.

- [ ] **Step 3: Viết `src/mcp/server.ts`**

```ts
import { McpServer } from "@modelcontextprotocol/server"
import type { CallToolResult } from "@modelcontextprotocol/server"
import {
  createMcpTools,
  getQuotaInputSchema,
  listQuotasInputSchema,
  refreshQuotaInputSchema,
  type McpToolsDeps
} from "./tools"

const SERVER_INFO = { name: "9router-quota-server", version: "0.1.0" }

/**
 * Được gọi MỖI request (mô hình per-request của createMcpHandler — xem
 * src/mcp/index.ts). Rẻ vì không có gì để khởi tạo ngoài đăng ký 3 tool;
 * quotaService đến từ closure, không bị dựng lại.
 */
export function buildMcpServer(deps: McpToolsDeps): McpServer {
  const tools = createMcpTools(deps)
  const server = new McpServer(SERVER_INFO)

  server.registerTool(
    "list_quotas",
    {
      description:
        "Liệt kê quota của mọi connection 9Router đã biết, từ snapshot trong bộ nhớ — không gọi 9Router. " +
        "Snapshot được làm mới định kỳ bởi tiến trình quét nền; entry có stale=true nghĩa là số liệu cũ hơn " +
        "bình thường (9Router có thể đang lỗi). Tên các pool quota khác nhau theo provider (credit, session, " +
        "weekly, premium_requests, *_freetrial, …) — đừng giả định tên cố định, hãy đọc từ chính danh sách " +
        "trả về. Lọc theo provider và/hoặc status; bỏ trống để lấy tất cả.",
      inputSchema: listQuotasInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async (input): Promise<CallToolResult> => tools.listQuotas(input)
  )

  server.registerTool(
    "get_quota",
    {
      description:
        "Lấy chi tiết quota của đúng một connection theo connection_id (dùng list_quotas để tìm id). Đọc từ " +
        "snapshot trong bộ nhớ, không gọi 9Router — số liệu có thể vài phút trước đó. Cần số mới nhất ngay " +
        "bây giờ thì gọi refresh_quota, đừng gọi lại tool này nhiều lần liên tiếp để chờ số đổi.",
      inputSchema: getQuotaInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async (input): Promise<CallToolResult> => tools.getQuota(input)
  )

  server.registerTool(
    "refresh_quota",
    {
      description:
        "Buộc lấy lại quota mới nhất từ 9Router cho một connection cụ thể — gọi thật ra provider, không đọc " +
        "cache. Có cooldown riêng cho từng connection: gọi lại quá sớm sẽ báo lỗi kèm số giây còn lại, hãy " +
        "đợi đúng thời gian đó rồi mới gọi lại, đừng lặp lại ngay hoặc dùng tool này để polling liên tục. " +
        "Chỉ gọi khi thực sự cần số liệu tức thời hơn snapshot đang có.",
      inputSchema: refreshQuotaInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    async (input): Promise<CallToolResult> => tools.refreshQuota(input)
  )

  return server
}
```

- [ ] **Step 4: Viết `src/mcp/index.ts`**

```ts
import { Elysia } from "elysia"
import { createMcpHandler } from "@modelcontextprotocol/server"
import { createGuards, type GuardDeps } from "../guards"
import { buildMcpServer } from "./server"
import type { McpToolsDeps } from "./tools"

export type McpRouteDeps = GuardDeps & McpToolsDeps

/**
 * Mount tại /mcp, Streamable HTTP, stateless. `.all()` thay vì `.post()` vì
 * SDK tự trả đúng mã theo protocol cho method không hỗ trợ (GET -> 405) —
 * để Elysia tự chặn bằng .post() sẽ trả 404 sai ngữ nghĩa so với 405 mà
 * client MCP mong đợi.
 */
export function createMcpRoutes(deps: McpRouteDeps) {
  const handler = createMcpHandler(() => buildMcpServer({ quotaService: deps.quotaService }))

  return new Elysia()
    .use(createGuards(deps))
    .all("/mcp", ({ request }) => handler.fetch(request), { apiKey: true, needsToken: true })
}
```

- [ ] **Step 5: Mount vào `src/http/index.ts`**

Tìm:
```ts
import { Elysia } from "elysia"
import type { Config } from "../config"
import type { TokenProvider } from "../auth"
import type { Poller } from "../poller"
import type { SnapshotStore } from "../store"
import { createHealthRoutes } from "./health"
import { createQuotasRoutes } from "./quotas"
import { createQuotaService } from "./quotaService"
import { createRefreshRoutes } from "./refresh"

export type ServerDeps = {
  config: Config
  store: SnapshotStore
  poller: Poller
  tokens: TokenProvider
  now: () => number
}

export function createServer(deps: ServerDeps) {
  const { config, store, poller, tokens, now } = deps
  const quotaService = createQuotaService({ store, poller, config, now })

  return new Elysia()
    .use(createHealthRoutes({ store, poller, tokens }))
    .use(createQuotasRoutes({ config, tokens, quotaService }))
    .use(createRefreshRoutes({ config, tokens, quotaService }))
}
```

Thay bằng:
```ts
import { Elysia } from "elysia"
import type { Config } from "../config"
import type { TokenProvider } from "../auth"
import type { Poller } from "../poller"
import type { SnapshotStore } from "../store"
import { createHealthRoutes } from "./health"
import { createMcpRoutes } from "../mcp"
import { createQuotasRoutes } from "./quotas"
import { createQuotaService } from "./quotaService"
import { createRefreshRoutes } from "./refresh"

export type ServerDeps = {
  config: Config
  store: SnapshotStore
  poller: Poller
  tokens: TokenProvider
  now: () => number
}

export function createServer(deps: ServerDeps) {
  const { config, store, poller, tokens, now } = deps
  const quotaService = createQuotaService({ store, poller, config, now })

  return new Elysia()
    .use(createHealthRoutes({ store, poller, tokens }))
    .use(createQuotasRoutes({ config, tokens, quotaService }))
    .use(createRefreshRoutes({ config, tokens, quotaService }))
    .use(createMcpRoutes({ config, tokens, quotaService }))
}
```

- [ ] **Step 6: Chạy lại test mới để xác nhận xanh**

```bash
bun test tests/mcp/server.test.ts
```

Expected: PASS, toàn bộ test kể cả assert "không có `force`" trong `tools/list`.

- [ ] **Step 7: Chạy toàn bộ suite**

```bash
bun test
```

Expected: PASS, không có test nào trong `tests/http/` bị ảnh hưởng bởi việc thêm route mới.

- [ ] **Step 8: Type-check toàn repo**

```bash
bunx tsc -p tsconfig.json
```

Expected: không có lỗi. Đây là lần đầu `strict` + `noUncheckedIndexedAccess` chạy qua toàn bộ `src/mcp/` và `src/http/schemas.ts` mới — nếu có lỗi kiểu, sửa tại đây trước khi commit.

- [ ] **Step 9: Commit**

```bash
git add src/mcp/server.ts src/mcp/index.ts src/http/index.ts tests/mcp/server.test.ts
git commit -m "feat: wire the MCP Streamable HTTP endpoint into the Elysia server"
```

---

### Task 8: Tài liệu và xác nhận cuối

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: nothing mới
- Produces: mục MCP trong README, cùng lệnh đăng ký client thật

- [ ] **Step 1: Thêm mục MCP vào `README.md`**

Tìm đoạn kết thúc bằng:
```
Tên các pool trong `quotas` khác nhau theo provider (`credit`, `session`,
`weekly`, `premium_requests`, …). **Đừng hardcode — hãy duyệt key.**

## Lưu ý vận hành
```

Thay bằng:
```
Tên các pool trong `quotas` khác nhau theo provider (`credit`, `session`,
`weekly`, `premium_requests`, …). **Đừng hardcode — hãy duyệt key.**

## MCP

Ngoài HTTP API, server còn phục vụ [MCP](https://modelcontextprotocol.io) qua
Streamable HTTP tại `/mcp`, để model tự tra cứu quota mà không cần ai viết sẵn
code gọi HTTP API. Cùng một `API_KEY`, cùng một tầng nghiệp vụ — không có đường
riêng ra 9Router, nên hàng đợi và cooldown vẫn áp dụng y hệt HTTP API.

| Tool | Tham số | Ghi chú |
|---|---|---|
| `list_quotas` | `provider?`, `status?` | Đọc snapshot, không gọi 9Router |
| `get_quota` | `connection_id` | Đọc snapshot, không gọi 9Router |
| `refresh_quota` | `connection_id` | Gọi thật ra 9Router, có cooldown; không có tham số `force` |

Đăng ký với Claude Code:

```bash
claude mcp add --transport http 9router-quota http://localhost:20129/mcp \
  --header "x-api-key: $API_KEY"
```

Client chỉ cho điền một token duy nhất thì gửi `Authorization: Bearer $API_KEY`
thay cho `x-api-key` — cả hai đều được server chấp nhận.

## Lưu ý vận hành
```

- [ ] **Step 2: Soát lại toàn bộ ba bất biến cứng của spec bằng grep**

```bash
# Không còn TypeBox trong code của ta
grep -rn 'import { t }' src

# force không lọt vào bất kỳ schema MCP nào
grep -n 'force' src/mcp/*.ts

# Đúng một bản zod
bun pm ls --all | grep -i zod
```

Expected: dòng 1 và dòng 2 không có output. Dòng 3 đúng một bản.

- [ ] **Step 3: Chạy toàn bộ suite lần cuối**

```bash
bun test
```

Expected: PASS, toàn bộ.

- [ ] **Step 4: Type-check lần cuối**

```bash
bunx tsc -p tsconfig.json
```

Expected: không có lỗi.

- [ ] **Step 5: Smoke test thủ công — server thật khởi động và `/mcp` trả lời đúng**

```bash
API_KEY=smoke-test PORT=0 bun run src/index.ts &
sleep 1
kill %1 2>/dev/null
```

(Bước này chỉ để chắc `bun run start` không crash ngay khi nạp `src/mcp/` — smoke test tự động hoá đầy đủ đã có ở `tests/mcp/server.test.ts` và `tests/smoke.test.ts`.)

- [ ] **Step 6: Commit**

```bash
git add README.md
git commit -m "docs: document the MCP surface in README"
```

---

## Tổng kết bao phủ spec

| Mục spec | Task |
|---|---|
| §2 Quyết định đã chốt (transport, thư viện, phạm vi tool, force, kết quả, session, hệ schema) | Task 1, 7 |
| §3 Kiến trúc, bất biến "MCP không có đường riêng ra 9Router" | Task 6, 7 |
| §4 Ba tool, mô tả tool | Task 6, 7 |
| §5 Định dạng Markdown, bảng quy tắc | Task 5 |
| §6 Xác thực — `x-api-key` + `Authorization: Bearer` | Task 3, 7 |
| §7 Lỗi — `isError` cho notFound/cooldown | Task 6 |
| §8.1 Refactor guards | Task 2 |
| §8.2 Chuyển schemas.ts sang zod | Task 4 |
| §9 Test, §9.1 lưới an toàn (server.test.ts không đổi) | Task 4, 5, 6, 7 |
| §10 Dependency, README | Task 1, 8 |
| §11 Rủi ro (pin version, một bản zod) | Task 1, 8 |
