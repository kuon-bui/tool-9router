# 9Router HTTP API

Tài liệu chuẩn cho việc gọi 9Router từ script, service khác hoặc hệ thống giám sát.

Nguồn sự thật của phần xác thực là `src/dashboardGuard.js`; phần token là
`src/shared/utils/machineId.js`. Khi hai file đó đổi, tài liệu này phải đổi theo.

- Base URL mặc định: `http://localhost:20128`
- Mọi response là JSON, trừ `/api/usage/stream` (SSE).
- Không có versioning cho `/api/*`. Đây là API nội bộ của dashboard, có thể đổi giữa các minor version.

---

## 1. Hai mặt phẳng API

9Router phục vụ hai nhóm đường dẫn khác nhau hoàn toàn về mục đích và cách xác thực.

| | LLM API | Dashboard API |
|---|---|---|
| Prefix | `/v1`, `/v1beta`, `/codex` | `/api/*` |
| Dùng để | Gửi request chat/embedding/image tới provider | Quản lý connection, đọc quota, cấu hình |
| Xác thực | API key (bảng `apiKeys`) | CLI token hoặc JWT cookie |
| Ổn định | Theo chuẩn OpenAI/Anthropic/Gemini | Nội bộ, có thể đổi |

**API key của `/v1` không mở được `/api/*`.** Đây là nhầm lẫn phổ biến nhất. Hàm
`isPublicLlmApi()` chỉ nhận diện các prefix ở cột trái; mọi thứ khác đi qua nhánh
deny-by-default và chỉ chấp nhận CLI token hoặc JWT.

---

## 2. Ma trận xác thực

Thứ tự kiểm tra trong `proxy()` — dừng ở nhóm khớp đầu tiên:

| # | Nhóm | Đường dẫn | Điều kiện đi qua |
|---|---|---|---|
| 1 | Local-only | `/api/cli-tools/cowork-settings`, `/api/cli-tools/antigravity-mitm`, `/api/mcp/`, `/api/tunnel/*` (enable, disable, tailscale-*), `/api/oauth/cursor/auto-import`, `/api/oauth/kiro/auto-import`, `/api/auth/reset-password`, `/api/headroom/{start,stop,proxy}` | CLI token, **hoặc** (peer loopback + Origin loopback + đã xác thực) |
| 2 | Always protected | `/api/shutdown`, `/api/settings/database`, `/api/version/shutdown`, `/api/version/update`, `/api/oauth/{cursor,kiro}/auto-import` | CLI token **hoặc** JWT hợp lệ. Không nới lỏng theo `requireLogin` |
| 3 | LLM API | `/v1*`, `/v1beta*`, `/api/v1*`, `/api/v1beta*`, `/codex*` | Request loopback, **hoặc** CLI token, **hoặc** API key hợp lệ |
| 4 | Public API | `/api/health`, `/api/init`, `/api/locale`, `/api/version`, `/api/auth/{login,logout,status,oidc,saml}`, `/api/settings/require-login` | Không cần gì |
| 5 | Còn lại `/api/*` | tất cả phần còn lại | CLI token, **hoặc** JWT, **hoặc** `settings.requireLogin === false` |
| 6 | `/dashboard/*` | trang HTML | JWT cookie, trừ khi `requireLogin === false` |

Nhóm 5 chứa những endpoint bạn thường cần: `/api/providers`, `/api/usage/*`,
`/api/models`, `/api/keys`, `/api/settings`, `/api/combos`, `/api/pricing`.

Khi từ chối, guard trả `401 {"error":"Unauthorized"}` (nhóm 2, 5),
`401 {"error":"API key required for remote API access"}` (nhóm 3),
hoặc `403 {"error":"Local only: CLI token required"}` (nhóm 1).

### Ghi chú về "request loopback"

`isLocalRequest()` chỉ trả `true` khi cả ba điều kiện đúng:

1. Không có header `x-9r-via-proxy` — `custom-server.js` đóng dấu header này khi phát hiện request đi qua reverse proxy.
2. Peer address là loopback, lấy từ header `x-9r-real-ip` do `custom-server.js` đóng dấu kèm token nội bộ, chứ không tin `X-Forwarded-For` của client.
3. Nếu request có `Origin`, hostname của nó cũng phải là loopback — chặn CSRF từ trang web bất kỳ.

Chạy `next dev` trần thì wrapper không được nạp nên không có peer address; ở
`NODE_ENV=development` guard tạm chấp nhận header `Host`. Đừng dựa vào hành vi này
ở production.

---

## 3. `x-9r-cli-token`

Cách xác thực khuyến nghị cho script và service chạy **trên cùng máy** với 9Router.
Không hết hạn, không cần đăng nhập, không phụ thuộc `requireLogin`.

### 3.1 Công thức

```
token = SHA256( rawMachineId ++ "9r-cli-auth" ++ cliSecret )  →  hex  →  16 ký tự đầu
```

Nối chuỗi trực tiếp, không có dấu phân cách. Đầu ra là 16 ký tự hex thường.
Cài đặt gốc: `getConsistentMachineId()` trong `src/shared/utils/machineId.js`.

Salt `"9r-cli-auth"` được truyền tường minh nên biến môi trường `MACHINE_ID_SALT`
**không** ảnh hưởng tới token này.

### 3.2 Nguồn dữ liệu

`DATA_DIR` được giải theo thứ tự (`src/lib/dataDir.js`):

1. Biến môi trường `DATA_DIR`. Trên Windows, giá trị bắt đầu bằng `/` bị bỏ qua — đường dẫn Unix lọt từ `.env` của Linux.
2. Windows: `%APPDATA%\9router`
3. Còn lại: `~/.9router`

Hai file cần đọc, cả hai đều mode `0600` và cần `.trim()`:

| File | Nội dung |
|---|---|
| `<DATA_DIR>/machine-id` | machine ID thô, server ghi ra ở lần chạy đầu |
| `<DATA_DIR>/auth/cli-secret` | 32 byte ngẫu nhiên dạng hex, sinh ở lần chạy đầu |

`cli-secret` tồn tại để token không đoán được ngay cả khi machine ID bị lộ. Vì phải
đọc được hai file này nên **CLI token chỉ tính được trên chính máy chạy server**.
Nếu file chưa có, khởi động 9Router (hoặc chạy CLI) một lần để nó tạo.

### 3.3 Sinh token

**Node.js**

```js
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

function dataDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "9router");
  }
  return path.join(os.homedir(), ".9router");
}

export function cliToken() {
  const dir = dataDir();
  const raw = fs.readFileSync(path.join(dir, "machine-id"), "utf8").trim();
  const secret = fs.readFileSync(path.join(dir, "auth", "cli-secret"), "utf8").trim();
  return crypto.createHash("sha256")
    .update(raw + "9r-cli-auth" + secret)
    .digest("hex")
    .substring(0, 16);
}
```

**PowerShell**

```powershell
$dir    = if ($env:DATA_DIR) { $env:DATA_DIR } else { Join-Path $env:APPDATA '9router' }
$raw    = (Get-Content (Join-Path $dir 'machine-id') -Raw).Trim()
$secret = (Get-Content (Join-Path $dir 'auth\cli-secret') -Raw).Trim()
$bytes  = [Security.Cryptography.SHA256]::Create().ComputeHash(
            [Text.Encoding]::UTF8.GetBytes($raw + '9r-cli-auth' + $secret))
$token  = (($bytes | ForEach-Object { $_.ToString('x2') }) -join '').Substring(0, 16)

Invoke-RestMethod http://localhost:20128/api/providers -Headers @{ 'x-9r-cli-token' = $token }
```

**Bash**

```bash
DIR="${DATA_DIR:-$HOME/.9router}"
RAW=$(tr -d '\r\n' < "$DIR/machine-id")
SECRET=$(tr -d '\r\n' < "$DIR/auth/cli-secret")
TOKEN=$(printf '%s' "${RAW}9r-cli-auth${SECRET}" | sha256sum | cut -c1-16)

curl -s -H "x-9r-cli-token: $TOKEN" http://localhost:20128/api/providers
```

### 3.4 Cách dùng

Gửi ở header trên mọi request:

```
x-9r-cli-token: <16 ký tự hex>
```

Header này được sanitizer của request-details che đi khi ghi log, cùng nhóm với
`x-9r-real-ip`. Dù vậy vẫn nên coi nó như mật khẩu: ai có token là có toàn quyền
dashboard API, kể cả nhóm local-only.

---

## 4. JWT cookie

Dùng khi client không đọc được `DATA_DIR` — ví dụ service chạy trên máy khác.

```bash
curl -c jar.txt -X POST http://localhost:20128/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"password":"<mật khẩu dashboard>"}'

curl -b jar.txt http://localhost:20128/api/usage/<connectionId>
```

| Thuộc tính | Giá trị |
|---|---|
| Tên cookie | `auth_token` |
| Thuật toán | HS256, secret từ `JWT_SECRET` hoặc `<DATA_DIR>/jwt-secret` |
| Hạn | 24 giờ |
| Cờ | `httpOnly`, `sameSite=lax`, `secure` khi `AUTH_COOKIE_SECURE=true` hoặc `x-forwarded-proto: https` |

Đăng xuất: `POST /api/auth/logout`.

### Các trường hợp login bị từ chối

| Mã | Nguyên nhân |
|---|---|
| 429 | Quá nhiều lần sai từ cùng IP. Body có `retryAfter` (giây), kèm header `Retry-After` |
| 403 kèm `mustChangePassword` | Cài mới còn dùng mật khẩu mặc định `123456` và request đến từ xa. Không cấp JWT. Phải đổi mật khẩu **từ máy local**, hoặc đặt `INITIAL_PASSWORD` trước lần chạy đầu |
| 403 | `authMode` là `sso`/`saml`/`oidc` — login bằng mật khẩu đã tắt |
| 403 | Request đi qua tunnel/tailscale mà `tunnelDashboardAccess !== true` |

Kiểm tra cấu hình đăng nhập trước khi thử: `GET /api/auth/status` (public) trả về
`requireLogin`, `authMode`, `hasPassword`, `authenticated`.

---

## 5. API key (chỉ cho `/v1`)

Tạo key:

```bash
curl -X POST http://localhost:20128/api/keys \
  -H "x-9r-cli-token: $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"my-service"}'
# 201 → { "id": "...", "key": "...", "name": "my-service", "machineId": "..." }
```

Key hợp lệ khi tồn tại trong bảng `apiKeys` và `isActive = 1`. Bốn cách gửi đều được
chấp nhận (`extractApiKey`):

```
Authorization: Bearer <key>
x-api-key: <key>
x-goog-api-key: <key>
?key=<key>
```

---

## 6. Endpoint reference

### 6.1 Hệ thống (public, không cần auth)

| Method | Path | Trả về |
|---|---|---|
| GET | `/api/health` | `{"ok":true}` — có CORS `*`, dùng làm health probe |
| GET | `/api/version` | `{currentVersion, latestVersion, hasUpdate}` — tra npm registry, cache 1 giờ |
| GET | `/api/auth/status` | Trạng thái cấu hình đăng nhập |
| GET | `/api/init` | Trạng thái khởi tạo |

### 6.2 Connection

| Method | Path | Ghi chú |
|---|---|---|
| GET | `/api/providers` | Danh sách connection. `apiKey`, `accessToken`, `refreshToken`, `idToken` bị strip |
| POST | `/api/providers` | Tạo connection API-key. OAuth đi luồng riêng |
| GET | `/api/providers/{id}` | Một connection |
| PUT | `/api/providers/{id}` | Cập nhật |
| DELETE | `/api/providers/{id}` | Xoá |

```jsonc
// GET /api/providers
{
  "connections": [
    {
      "id": "c1a2b3...",
      "provider": "kiro",
      "authType": "oauth",          // "oauth" | "apikey" | "api_key"
      "name": "Kiro #1",
      "email": "...",
      "priority": 10,
      "isActive": true,
      "providerSpecificData": { },
      "createdAt": "...", "updatedAt": "..."
    }
  ]
}
```

### 6.3 Quota của account

```
GET /api/usage/{connectionId}
GET /api/usage/{connectionId}?force=1
```

Endpoint duy nhất trả về quota thật lấy từ phía provider.

```jsonc
{
  "plan": "Kiro Pro",
  "quotas": {
    "credit": {
      "used": 12.5,
      "total": 50,
      "remaining": 37.5,
      "resetAt": "2026-09-01T00:00:00.000Z",
      "unlimited": false
    }
  }
}
```

Tên các pool trong `quotas` khác nhau theo provider (`credit`, `session`, `weekly`,
`premium_requests`, `*_freetrial`, …). Đừng hardcode; hãy duyệt key.

**Điều kiện có dữ liệu.** Connection phải là `authType === "oauth"`, hoặc là apikey
thuộc danh sách `features.usageApikey` trong registry. Không thoả thì trả **200** với
`{"message":"Usage not available for this connection"}` — hãy kiểm tra sự tồn tại của
`quotas` chứ đừng dựa vào HTTP status.

20 provider hiện khai báo `transport.usage`: `antigravity`, `claude`, `codebuddy-cn`,
`codebuddy-intl`, `codex`, `deepseek`, `gemini-cli`, `github`, `glm`, `glm-cn`,
`grok-cli`, `kimi`, `kiro`, `minimax`, `minimax-cn`, `ollama`, `qoder`, `trae`,
`vercel-ai-gateway`, `zed`.

**Endpoint này không read-only.** Với connection OAuth, nó gọi
`executor.refreshCredentials()` và **ghi token mới vào DB** trước khi hỏi quota; nếu
provider báo token hết hạn thì force-refresh rồi thử lại một lần.

| Mã | Ý nghĩa |
|---|---|
| 200 kèm `quotas` | Thành công |
| 200 kèm `message` | Connection không hỗ trợ quota, hoặc lỗi mềm phía provider (rate limit, token hỏng) |
| 401 | Refresh credential thất bại — cần authorize lại connection |
| 404 | Không có connection với id đó |
| 500 | Lỗi ngoài dự kiến |

Ngoài ra: `POST /api/usage/{connectionId}/codex-reset-credits` (chỉ Codex).

### 6.4 Số liệu tự đếm

Khác với 6.3, nhóm này là thống kê 9Router tự ghi lại, có cho **mọi** provider.

| Method | Path | Tham số | Ghi chú |
|---|---|---|---|
| GET | `/api/usage/stats` | `period` ∈ `today,24h,7d,30d,60d,all` (mặc định `7d`) | Tổng hợp đầy đủ |
| GET | `/api/usage/chart` | `period` ∈ `today,24h,7d,30d,60d` | Mảng `[{label, tokens, cost}]` |
| GET | `/api/usage/history` | — | Giống `stats` với period mặc định |
| GET | `/api/usage/logs` | — | 200 dòng gần nhất, mảng **chuỗi** đã format |
| GET | `/api/usage/request-logs` | — | Giống `/logs` |
| GET | `/api/usage/request-details` | `page`, `pageSize` (1–100), `provider`, `model`, `connectionId`, `status`, `startDate`, `endDate` | Chi tiết từng request, phân trang |
| GET | `/api/usage/providers` | — | Provider từng xuất hiện trong log |
| GET | `/api/usage/stream` | — | **SSE**, tự đẩy khi có thay đổi |

Shape của `/api/usage/stats`:

```jsonc
{
  "totalRequests": 0,
  "totalPromptTokens": 0, "totalCompletionTokens": 0,
  "totalCachedTokens": 0, "totalCost": 0,
  "byProvider": { "<provider>": { "requests", "promptTokens", "completionTokens", "cachedTokens", "cost" } },
  "byModel":    { "<model> (<provider>)": { "…", "rawModel", "provider", "lastUsed" } },
  "byAccount":  { "<model> (<provider> - <account>)": { "…", "connectionId", "accountName", "lastUsed" } },
  "byApiKey":   { "…": { "…", "apiKeyMasked", "keyName" } },
  "byEndpoint": { "…": { "…", "endpoint" } },
  "last10Minutes": [],
  "pending": { },
  "activeRequests": [ { "model", "provider", "account", "count" } ],
  "recentRequests": [ { "timestamp", "model", "provider", "promptTokens", "completionTokens", "cachedTokens", "status" } ],
  "errorProvider": ""
}
```

`/api/usage/stream` đẩy đúng object trên. Mỗi tick nó gửi hai lần: một bản nhẹ chỉ cập
nhật `activeRequests`/`recentRequests`, rồi một bản tính lại đầy đủ. Theo dõi liên tục
thì dùng endpoint này thay vì poll.

`/api/usage/logs` trả mảng chuỗi, không phải object:

```
"28-08-2026 10:15:03 | claude-opus-5 | KIRO | Kiro #1 | 12043 | 388 | ok"
```

### 6.5 Model, key, cấu hình

| Method | Path | Ghi chú |
|---|---|---|
| GET, PUT | `/api/models` | Model kèm `alias`, `routedModel`, `caps` (`vision`, `search`, `reasoning`, `contextWindow`, `maxOutput`) |
| GET, PUT, DELETE | `/api/models/alias` | Alias model |
| GET, POST | `/api/models/availability` | Kiểm tra model khả dụng |
| GET, POST | `/api/keys` | API key cho `/v1` |
| GET, PUT, DELETE | `/api/keys/{id}` | |
| GET, PATCH | `/api/settings` | `password`, `oidcClientSecret` bị strip; thêm `hasPassword`, `enableRequestLogs`, `enableTranslator` |
| GET, POST | `/api/combos`, `/api/provider-nodes`, `/api/proxy-pools` | |
| GET, PATCH, DELETE | `/api/pricing` | Bảng giá |
| GET | `/api/tags` | |

---

## 7. Lưu ý vận hành

**Không có endpoint lấy quota hàng loạt.** Phải `GET /api/providers` rồi gọi
`GET /api/usage/{id}` cho từng connection. Dashboard cũng làm đúng như vậy.

**Gọi tuần tự, có delay.** Chỉ handler của Claude có cache — TTL 300s, dedup in-flight,
cooldown 180s sau khi ăn 429, giữ last-good khi lỗi mềm. Các handler còn lại gọi thẳng
provider mỗi lần. Fan-out song song nhiều account rất dễ khiến chính provider rate-limit
bạn.

**Đừng mặc định dùng `force=1`.** Nó bỏ qua cache. Endpoint quota OAuth của Anthropic sẽ
trả 429 và bị khoá cooldown 180s. Chỉ dùng khi người dùng bấm refresh thủ công.

**Quota không được lưu.** Không có bảng quota trong `<DATA_DIR>/db/data.sqlite`; cache chỉ
nằm trong bộ nhớ tiến trình. Restart là mất. Muốn có chuỗi thời gian thì phía bạn phải
tự lưu.

**Đừng hardcode danh sách provider hỗ trợ quota.** Registry thay đổi mỗi bản phát hành.
Cứ gọi rồi kiểm tra sự tồn tại của `quotas` trong response.

**`/api/*` không có hợp đồng ổn định.** Nó phục vụ dashboard trước hết. Khi nâng cấp
9Router, kiểm tra lại shape trước khi tin vào script cũ.
