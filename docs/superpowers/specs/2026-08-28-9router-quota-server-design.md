# 9Router Quota Server — Thiết kế

Ngày: 2026-08-28
Trạng thái: chờ review

## 1. Mục tiêu

Một mini HTTP server chạy cùng máy với 9Router, expose quota của mọi connection cho các service bên ngoài qua một API gọn và ổn định.

Nó tồn tại vì ba lý do, tất cả đều lấy từ `docs/HTTP-API.md`:

1. **9Router không có endpoint lấy quota hàng loạt.** Muốn biết quota toàn bộ account phải `GET /api/providers` rồi gọi `GET /api/usage/{id}` cho từng cái. Bắt mỗi service tiêu thụ tự làm việc đó là nhân bản logic và nhân bản rủi ro.
2. **CLI token chỉ tính được trên chính máy chạy 9Router**, vì phải đọc `<DATA_DIR>/machine-id` và `<DATA_DIR>/auth/cli-secret`. Service ở máy khác không tự xác thực được.
3. **Fan-out song song dễ khiến provider rate-limit.** Tài liệu yêu cầu gọi tuần tự có delay. Một điểm điều phối duy nhất biến yêu cầu đó thành bất biến của hệ thống thay vì quy ước mà mỗi client tự giữ.

### Ngoài phạm vi

- Lưu lịch sử quota / time-series. Snapshot chỉ nằm trong RAM, restart là mất.
- Gộp số liệu tự đếm của 9Router (`/api/usage/stats`, token, cost).
- Cảnh báo, thông báo khi quota sắp hết.
- Giao diện web.

## 2. Stack

Bun + Elysia (TypeScript). Bun có sẵn đọc file và SHA256 nên phần tính CLI token không cần dependency. Elysia dùng `macro` với `resolve` trả `status(401)` để guard route bằng API key — đây là cách chính tắc của framework ở phiên bản 1.3.

## 3. Kiến trúc

Mọi lời gọi ra 9Router đi qua đúng một worker. Không có đường nào khác.

```
service ngoài ──▶ Elysia (apiKey macro) ──▶ SnapshotStore (RAM)
                                                  ▲
                        Poller (5 phút/vòng) ─────┤
                                    │             │
                                    ▼             │
                          Queue (1 worker, delay) ┘
                                    │
                                    ▼
                          9Router :20128  (x-9r-cli-token)
```

Client không bao giờ chờ 9Router: handler đọc `SnapshotStore` rồi trả ngay. Chỉ endpoint refresh mới chạm hàng đợi. Tải phía client vì thế tách hoàn toàn khỏi nhịp gọi phía provider — mười service poll mỗi giây cũng không sinh thêm một request nào ra ngoài.

### 3.1 Vì sao một hàng đợi thay vì scheduler theo connection

Phương án thay thế là mỗi connection tự chạy timer và cooldown riêng, refresh gọi thẳng connection đó. Refresh phản hồi nhanh hơn, nhưng nhiều connection dễ trùng thời điểm và bắn song song — đúng cái fan-out tài liệu cảnh báo. Muốn an toàn lại phải thêm semaphore toàn cục, tức là quay về một hàng đợi bằng đường vòng.

Cái giá của hàng đợi đơn: refresh một connection có thể chờ vài giây nếu hàng đợi đang bận. Rẻ hơn nhiều so với bị provider khoá cooldown 180s.

### 3.2 Module

Mỗi miền là một thư mục con của `src/`, có `index.ts` làm barrel export; nơi khác import qua đường dẫn thư mục (`./auth`, `../store`, …) chứ không trỏ thẳng vào file cụ thể.

| Thư mục / file | Trách nhiệm | Phụ thuộc |
|---|---|---|
| `src/config.ts` | Đọc và validate env, fail fast lúc khởi động | — |
| `src/types.ts` | Kiểu dùng chung xuyên suốt mọi miền | — |
| `src/auth/` | Giải `DATA_DIR`, đọc hai file, băm ra token 16 hex | config |
| `src/upstream/` | Client mỏng của 9Router (`client.ts`) và diễn giải response thô (`normalize.ts`: `normalizePools`, `classifyUsageResponse`, `normalizeConnections`) | auth, config, types |
| `src/queue/` | Hàng đợi ưu tiên, một worker, delay giữa các job, dedup theo key | — |
| `src/store/` | Snapshot in-memory (`snapshotStore.ts`) và cách một kết quả được áp vào entry (`apply.ts`: `pendingEntry`, `applyResult`) | types |
| `src/poller/` | Vòng quét định kỳ, nạp job ưu tiên thấp | queue, store, upstream |
| `src/http/` | Route Elysia và macro `apiKey` | store, poller, auth, config, types |
| `src/index.ts` | Ghép mọi thứ, khởi động, graceful shutdown | tất cả |

`normalize.ts` (trong `upstream/`) và `apply.ts` (trong `store/`) từng nằm chung một file `normalize.ts` duy nhất; tách ra vì chúng phục vụ hai tiêu dùng khác nhau — một bên diễn giải response HTTP thô, một bên biến đổi state nội bộ.

`queue/`, `store/`, và phần `normalize.ts`/`apply.ts` không biết gì về 9Router. Các module này test được mà không cần network.

## 4. Xác thực với 9Router

Dùng header `x-9r-cli-token`, không dùng JWT — server chạy cùng máy nên đọc được `DATA_DIR`, và CLI token không hết hạn, không phụ thuộc `requireLogin`.

### 4.1 Giải DATA_DIR

Theo đúng `src/lib/dataDir.js` của 9Router:

1. Biến môi trường `DATA_DIR`. **Trên Windows, giá trị bắt đầu bằng `/` bị bỏ qua** (đường dẫn Unix lọt từ `.env` của Linux), rơi xuống bước 2.
2. Windows: `%APPDATA%\9router`
3. Còn lại: `~/.9router`

### 4.2 Công thức token

```
token = SHA256( rawMachineId ++ "9r-cli-auth" ++ cliSecret ) → hex → 16 ký tự đầu
```

Nối chuỗi trực tiếp, không dấu phân cách. Cả hai file đều phải `.trim()`. Salt `"9r-cli-auth"` truyền tường minh nên `MACHINE_ID_SALT` không ảnh hưởng.

Token được tính **một lần lúc boot** rồi giữ trong RAM. `bootstrap()` gọi tới nó trước khi `listen()`, nên tới lúc server nhận request đầu tiên thì token đã sẵn sàng. Machine ID và cli-secret không đổi khi 9Router đang chạy, nên đọc lại mỗi lần gọi là thừa.

**Chỉ cache khi thành công.** Thất bại không được cache — đó là cơ chế tự hồi phục: nếu 9Router chưa từng chạy nên chưa có file, lượt lấy token ở vòng quét kế tiếp sẽ thử đọc lại và bắt được ngay khi file xuất hiện. Vì thế không cần method reset thủ công.

### 4.3 Coi token như mật khẩu

Ai có token là có toàn quyền dashboard API của 9Router, kể cả nhóm local-only. Token không được log, không xuất hiện trong bất kỳ response nào, kể cả `/health` và trang lỗi.

## 5. API expose ra ngoài

Bind `0.0.0.0`. Mọi endpoint trừ `/health` yêu cầu header `x-api-key` khớp `API_KEY` trong env. So sánh bằng thuật toán constant-time.

| Method | Path | Auth | Hành vi |
|---|---|---|---|
| GET | `/health` | không | `{ok, upstream, tokenReady, connections, lastSweepAt}` |
| GET | `/quotas` | có | Toàn bộ snapshot; lọc `?provider=`, `?status=` |
| GET | `/quotas/:id` | có | Một connection; `404` nếu không có trong snapshot |
| POST | `/refresh` | có | Nạp cả sweep ở ưu tiên cao, trả `202` ngay, không chờ |
| POST | `/refresh/:id` | có | Chờ job xong rồi trả entry mới; `429` nếu còn cooldown |

`/health` không yêu cầu auth để dùng làm probe cho load balancer và `docker healthcheck`. Nó không tiết lộ gì ngoài trạng thái vận hành.

### 5.1 Shape của một entry

Cố định, không phụ thuộc provider:

```jsonc
{
  "connectionId": "c1a2b3...",
  "provider": "kiro",
  "name": "Kiro #1",
  "authType": "oauth",
  "status": "ok",              // ok | unavailable | unauthorized | error | pending
  "plan": "Kiro Pro",
  "quotas": {                   // key giữ nguyên từ provider
    "credit": {
      "used": 12.5, "total": 50, "remaining": 37.5,
      "resetAt": "2026-09-01T00:00:00.000Z", "unlimited": false
    }
  },
  "message": null,
  "fetchedAt": "2026-08-28T10:15:03.000Z",
  "stale": false
}
```

**Không hardcode tên pool trong `quotas`.** Tài liệu liệt kê `credit`, `session`, `weekly`, `premium_requests`, `*_freetrial` và nói rõ danh sách này khác nhau theo provider. `normalize.ts` duyệt key, giữ nguyên tên, không map lại.

Tương tự, **không hardcode danh sách provider hỗ trợ quota.** Registry của 9Router đổi mỗi bản phát hành. Cứ gọi rồi kiểm tra sự tồn tại của `quotas`.

### 5.2 Ánh xạ trạng thái

Đây là giá trị chính mà server tạo ra: dịch quy ước khó chịu của 9Router thành thứ client dùng trực tiếp được.

| 9Router trả về | `status` | Xử lý |
|---|---|---|
| `200` có `quotas` | `ok` | Ghi đè entry, `stale:false` |
| `200` có `message` | `unavailable` | Chuyển nguyên `message`, `quotas:null` |
| `401` | `unauthorized` | Cần authorize lại connection ở 9Router |
| `404` | — | Connection đã bị xoá, gỡ khỏi snapshot |
| `500` / timeout / lỗi mạng | `error` | **Giữ nguyên `quotas` lần lấy được cuối**, bật `stale`, ghi `message` |
| chưa từng quét | `pending` | Mới thấy connection, chưa có lượt gọi nào |

Với `200` kèm `message`, tài liệu nói rõ nó có thể là "connection không hỗ trợ quota" **hoặc** "lỗi mềm phía provider (rate limit, token hỏng)" — response không cho phép phân biệt. Server không đoán: dùng chung một `status` và chuyển nguyên văn `message` để con người đọc.

Không được dựa vào HTTP status của 9Router để biết có quota hay không. Phải kiểm tra sự tồn tại của trường `quotas`.

### 5.3 force=1

Chỉ mở ở `POST /refresh/:id`, qua query `?force=1`, mặc định tắt. Có cooldown riêng theo connection.

Tài liệu cảnh báo trực tiếp: `force=1` bỏ qua cache, và endpoint quota OAuth của Anthropic sẽ trả `429` rồi bị khoá cooldown 180s. Vòng poll nền **không bao giờ** dùng `force`.

### 5.4 Tác dụng phụ của việc lấy quota

`GET /api/usage/{id}` **không read-only**. Với connection OAuth nó gọi `executor.refreshCredentials()` và ghi token mới vào DB của 9Router trước khi hỏi quota. Nghĩa là vòng poll của server này liên tục làm 9Router xoay token.

Đó là lý do chu kỳ poll mặc định là 5 phút chứ không phải 30 giây. Ai chỉnh `POLL_INTERVAL_MS` xuống thấp cần biết mình đang tăng tần suất ghi DB phía 9Router, không chỉ tăng lưu lượng đọc.

## 6. Cấu hình

Đọc một lần lúc boot.

| Biến | Mặc định | Ghi chú |
|---|---|---|
| `PORT` | `20129` | Cạnh 9Router `20128` |
| `HOST` | `0.0.0.0` | Cho service máy khác gọi |
| `API_KEY` | — | **Bắt buộc**, thiếu là thoát với exit code 1 |
| `UPSTREAM_URL` | `http://localhost:20128` | |
| `DATA_DIR` | tự giải | Quy tắc ở 4.1 |
| `POLL_INTERVAL_MS` | `300000` | 5 phút |
| `REQUEST_DELAY_MS` | `1500` | Giữa hai job liên tiếp |
| `REFRESH_COOLDOWN_MS` | `60000` | Mỗi connection |
| `UPSTREAM_TIMEOUT_MS` | `20000` | Timeout mỗi lời gọi upstream |

`API_KEY` bắt buộc là quyết định có chủ ý: server bind `0.0.0.0` và nắm CLI token có toàn quyền dashboard, nên khởi động không key phải là lỗi, không phải cảnh báo.

## 7. Vòng đời và xử lý lỗi

Nguyên tắc chung: server này chạy dưới dạng service nền, nên nó **không tự tắt vì lỗi ngoài tầm kiểm soát**. Chỉ lỗi cấu hình mới làm nó thoát.

**Thiếu `API_KEY`** — in thông báo rõ ràng, thoát code 1. Lỗi cấu hình, restart không cứu được.

**Thiếu `machine-id` hoặc `auth/cli-secret`** — xảy ra khi 9Router chưa từng chạy. Không crash, vì service sẽ vào vòng restart vô tận. Lượt tính token lúc boot thất bại chỉ in cảnh báo; server vẫn khởi động, `/health` trả `tokenReady:false` kèm hướng dẫn chạy 9Router một lần để nó sinh file, các endpoint quota trả `503`. Vì thất bại không được cache, vòng quét kế tiếp sẽ thử đọc lại và server tự hồi phục khi 9Router lên, không cần can thiệp.

**9Router chết giữa chừng** — snapshot cũ vẫn được phục vụ với `stale:true`, `/health` báo `upstream:"down"`. Poller tiếp tục thử theo chu kỳ.

**Một connection lỗi** — không làm hỏng cả vòng quét. Mỗi job độc lập; lỗi được ghi vào entry của chính connection đó.

`stale` bật khi `fetchedAt` cũ hơn hai lần `POLL_INTERVAL_MS`, hoặc khi lượt lấy gần nhất thất bại.

Graceful shutdown trên `SIGINT`/`SIGTERM`: dừng nhận request mới, để job đang chạy kết thúc, rồi thoát.

## 8. Chiến lược test

Dùng `bun:test`. Ba tầng, không tầng nào cần 9Router thật. Viết theo TDD: test trước, cho fail, rồi mới implement.

**Tầng thuần.** `normalize.ts` với đủ sáu nhánh xử lý ở bảng 5.2 (năm giá trị `status` cộng nhánh gỡ khỏi snapshot khi `404`), `quotas` rỗng, và một tên pool chưa từng thấy (khẳng định nó được giữ nguyên chứ không bị loại). `cliToken.ts` **không có test đơn vị riêng** — đây là lựa chọn có chủ ý của chủ dự án. Công thức token và cách giải `DATA_DIR` vẫn được kiểm end-to-end ở tầng tích hợp: smoke test dựng thư mục dữ liệu giả với `machine-id`/`cli-secret` biết trước và bắt fake 9Router chỉ chấp nhận đúng token tương ứng, nên sai thứ tự nối chuỗi, sai salt, hay quên cắt 16 ký tự đều làm test đỏ.

**Tầng hàng đợi.** Chỗ dễ sai nhất và cũng là bất biến quan trọng nhất, nên test khẳng định trực tiếp: không bao giờ có hai job chạy đồng thời; delay giữa các job được tôn trọng; job ưu tiên cao chen lên trước job ưu tiên thấp đang chờ; hai refresh cùng một connection dedup thành một lần gọi.

**Tầng tích hợp.** Dựng một Elysia giả đóng vai 9Router, trả đúng các shape trong `docs/HTTP-API.md` kể cả `200` kèm `message`, `401`, `404`. Chạy server thật đối chiếu với nó: `/quotas` không key trả `401`; sai key trả `401`; upstream sập thì last-good được giữ và `stale` bật; refresh trong cooldown trả `429`; connection biến mất khỏi `/api/providers` thì bị gỡ khỏi snapshot.

## 9. Rủi ro đã biết

**`/api/*` của 9Router không có hợp đồng ổn định.** Tài liệu nói thẳng nó phục vụ dashboard trước hết và có thể đổi giữa các minor version. `normalize.ts` là lớp cách ly: khi upstream đổi shape, chỉ một file phải sửa, API expose ra ngoài giữ nguyên. Khi nâng cấp 9Router cần chạy lại tầng test tích hợp.

**Quota không được lưu ở đâu cả.** Không có bảng quota trong SQLite của 9Router; cache chỉ nằm trong RAM tiến trình. Server này cũng vậy. Nếu sau này cần chuỗi thời gian thì phải thêm tầng lưu trữ — đã ghi ở mục ngoài phạm vi.
