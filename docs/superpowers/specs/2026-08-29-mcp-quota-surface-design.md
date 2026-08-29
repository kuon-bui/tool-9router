# Bề mặt MCP cho Quota Server — Thiết kế

Ngày: 2026-08-29
Trạng thái: chờ review

## 1. Mục tiêu

Cho phép model lấy quota của mọi connection 9Router qua MCP, thay vì phải có người
viết sẵn code gọi HTTP API.

HTTP API hiện tại phục vụ tốt service viết bằng tay: người lập trình đọc
`docs/HTTP-API.md`, biết đường dẫn, biết header, viết một lời gọi. Model không có
bước đó. Nó cần một bề mặt **tự mô tả** — tool có tên, có schema, có mô tả — để tự
quyết định gọi cái gì và truyền tham số nào. MCP là chuẩn cho việc đó.

Bề mặt mới không thay thế HTTP API. Hai mặt tiền cùng đứng trên một lõi.

### Ngoài phạm vi

- Transport stdio. Chỉ làm Streamable HTTP.
- MCP resources và prompts. Nhiều client bỏ qua resources, làm ra dễ thành code chết.
- Tool phân tích sẵn (`find_available_connection`, `list_exhausted`). Xếp hạng quota
  đòi ngưỡng, mà mỗi provider đặt tên pool một kiểu — logic đó dễ sai và phải bảo trì
  song song với HTTP API. Model tự suy luận từ dữ liệu.
- `force=1` qua MCP. Xem §4.3.
- Sweep toàn bộ (`POST /refresh`) qua MCP. Một model không nên châm được một vòng
  quét toàn hệ thống.
- OAuth cho MCP. Dùng lại `API_KEY` sẵn có.

## 2. Quyết định đã chốt

| Câu hỏi | Chốt | Vì sao |
|---|---|---|
| Transport | Streamable HTTP tại `/mcp`, cùng process Elysia | Server này là daemon giữ snapshot trong RAM. stdio bị spawn lại mỗi phiên và vẫn phải quay về gọi daemon — mất chính thứ khiến daemon tồn tại |
| Thư viện | `@modelcontextprotocol/server` v2, pin chính xác `2.0.0` | v2 xuất `WebStandardStreamableHTTPServerTransport` nhận `Request` trả `Response` chuẩn Web — cắm thẳng vào Bun/Elysia, không cần shim `node:http` |
| Phạm vi tool | `list_quotas`, `get_quota`, `refresh_quota` | Đọc + làm tươi. Không sinh nghiệp vụ mới ngoài `quotaService` |
| `force` | Không expose | §4.3 |
| Kết quả tool | Chỉ text, định dạng Markdown | §5 |
| Session | Stateless | §3.2 |

## 3. Kiến trúc

### 3.1 Vị trí

```
                     ┌── /health, /quotas, /refresh   (src/http/)
service ngoài ──▶ Elysia ─┤
client MCP    ──▶         └── /mcp                    (src/mcp/)
                                 │
                                 ▼
                           quotaService
                                 │
                     ┌───────────┴───────────┐
                     ▼                       ▼
              SnapshotStore              Poller
                                             │
                                             ▼
                                       SerialQueue (1 worker, delay)
                                             │
                                             ▼
                                     9Router :20128
```

**Bất biến: MCP không có đường riêng ra 9Router.** Nó gọi đúng `quotaService` mà
`src/http/quotas.ts` và `src/http/refresh.ts` đang gọi. Hệ quả là hàng đợi một worker,
delay giữa các job, và cooldown theo từng connection tự động áp dụng cho MCP mà không
cần viết lại. Mười model cùng gọi `refresh_quota` không sinh thêm một fan-out nào ra
provider — đúng yêu cầu của `docs/HTTP-API.md` §7.

Đây cũng là lý do `src/mcp/` được phép tồn tại như một miền riêng: nó **chỉ** dịch
protocol. Không có state, không có nghiệp vụ. Nếu có ngày nào đó nó cần biết
`SnapshotStore` là gì, thiết kế đã sai.

### 3.2 Stateless

Transport dựng với `sessionIdGenerator: undefined`. Mỗi POST tự đủ; không giữ session
giữa các request, không có `Mcp-Session-Id`.

Chế độ có session tồn tại để server đẩy notification hoặc giữ ngữ cảnh riêng cho từng
client. Server này không có gì để đẩy và không có gì để nhớ — snapshot là toàn cục,
giống hệt nhau với mọi người gọi. Thêm session chỉ thêm state phải dọn.

## 4. Bề mặt tool

Ba tool. Tên snake_case theo quy ước MCP.

### 4.1 `list_quotas`

Đọc thuần từ snapshot. Không sinh request nào ra 9Router.

```ts
{
  provider: z.string().optional(),
  status: z.enum(["ok", "unavailable", "unauthorized", "error", "pending"]).optional()
}
```

Annotation: `readOnlyHint: true`.

Không phân trang. Với 20 connection nhiều pool, kết quả cỡ 1.5–2.5k token — chấp nhận
được, và bộ lọc `provider`/`status` đã đủ để thu hẹp. Thêm phân trang lúc này là giải
quyết vấn đề chưa có.

### 4.2 `get_quota`

```ts
{ connection_id: z.string().min(1) }
```

Đọc thuần. Annotation: `readOnlyHint: true`.

### 4.3 `refresh_quota`

```ts
{ connection_id: z.string().min(1) }
```

Nạp một job ưu tiên cao vào `SerialQueue` và chờ kết quả, qua
`quotaService.refreshOne(id, false)`.

**`force` bị đóng cứng ở `false`, và không xuất hiện trong schema.** Không phải mặc
định — không có đường nào bật. `docs/HTTP-API.md` cảnh báo `force=1` bỏ qua cache
9Router và khiến endpoint quota OAuth của Anthropic trả 429 rồi khoá cooldown 180s.
Một tham số boolean tên là `force` nằm trong schema là một tham số model sẽ thử, nhất
là khi nó vừa thấy số liệu `stale`. Người vận hành cần force thì vẫn có
`POST /refresh/:id?force=1` trên HTTP API — nơi có một con người bấm nút.

Annotation: `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: false`.

### 4.4 Mô tả tool

Mô tả là thứ duy nhất điều khiển hành vi model, nên nó là phần phải viết kỹ nhất, không
phải phần chép từ tên hàm. Ba điều bắt buộc phải có:

1. **Số liệu có thể cũ.** Nêu rõ snapshot được làm tươi mỗi `POLL_INTERVAL_MS`, và
   trường `stale` nghĩa là gì.
2. **`refresh_quota` tốn một lời gọi thật và có cooldown.** Nêu rõ để model không gọi
   trong vòng lặp, và không gọi khi số liệu vừa mới.
3. **Tên pool khác nhau theo provider** (`credit`, `session`, `weekly`,
   `premium_requests`, `*_freetrial`, …). Phải duyệt key, đừng đoán. Đây đúng là cảnh
   báo mà `docs/HTTP-API.md` và `README.md` đã lặp hai lần cho người đọc; model cũng
   cần nghe.

Mô tả viết bằng tiếng Việt, thống nhất với phần còn lại của repo. Quyết định này đảo
được trong một file nếu sau này cần interop rộng hơn.

## 5. Định dạng kết quả

Chỉ trả `content` dạng text, **không** `structuredContent`, **không** `outputSchema`.

Lý do bỏ `structuredContent`: phần lớn client đẩy cả text lẫn JSON vào context model,
tức gần như nhân đôi token cho cùng một thông tin. Client nào thật sự cần JSON để parse
thì đã có `GET /quotas` — bề mặt đó không mất đi.

Text được định dạng Markdown để client render ra cho người xem đọc được ngay. Bảng và
thanh tiến trình tốn nhiều token hơn dòng phẳng một chút; đổi lại vẫn rẻ hơn hẳn JSON,
và cả người lẫn model đều đọc tốt hơn.

### 5.1 `list_quotas`

```markdown
**3 connection** · snapshot lúc `2026-08-29T09:12:04Z`

### kiro · Kiro #1 `c1a2b3`  ✅ ok
`credit`  ████░░░░░░░░░░░░  25%  ·  12.5 / 50  ·  còn 37.5  ·  reset `2026-09-01T00:00:00Z`

### codex · Codex #1 `a7b8c9`  ✅ ok  ⏳ số liệu cũ
`session`  ████████████░░░░  80%  ·  80 / 100  ·  còn 20  ·  reset `2026-08-29T12:00:00Z`
`weekly`   ████░░░░░░░░░░░░  30%  ·  300 / 1000  ·  còn 700

### claude · Claude #2 `d4e5f6`  ⛔ unauthorized
Cần authorize lại connection này trong dashboard 9Router.
```

Quy tắc dựng:

| Tình huống | Hiển thị |
|---|---|
| `unlimited: true` | `∞` thay cho thanh và tỉ lệ |
| `total` là `null` hoặc `0` | Bỏ thanh và `%`, chỉ in những trường có giá trị |
| `used` là `null` | Bỏ thanh và `%`, in `remaining` / `total` nếu có |
| `stale: true` | Thêm `⏳ số liệu cũ` sau trạng thái |
| `status` khác `ok` | Bỏ phần pool, in `message` thành một dòng văn xuôi |
| `quotas` rỗng hoặc `null` | In `message`, không in bảng rỗng |
| Danh sách rỗng sau khi lọc | Một dòng nêu rõ đã lọc theo gì, gợi ý bỏ bộ lọc |

Phần trăm là **phần đã dùng** (`used / total`), không phải phần còn lại — cùng hướng
với thanh, để thanh đầy nghĩa là hết quota. Thanh dài cố định 16 ô; số ô đầy làm tròn
xuống, còn con số `%` in ra là giá trị thật đã làm tròn tới đơn vị. Hai giá trị có thể
lệch nhau chút ít (80% → 12/16 ô), và đó là chủ ý: thanh để liếc, số để đọc.

Biểu tượng trạng thái: `ok` ✅, `unavailable` ➖, `unauthorized` ⛔, `error` ❌,
`pending` ⏱. Tên trạng thái vẫn in bằng chữ bên cạnh — biểu tượng là phần thêm, không
phải phần mang nghĩa. Client render bằng font không có emoji vẫn đọc được đủ.

### 5.2 `get_quota` và `refresh_quota`

Đúng một khối như trên, không có dòng đếm ở đầu. `refresh_quota` thêm một dòng xác nhận
thời điểm vừa lấy, để model phân biệt được số vừa làm tươi với số đọc từ snapshot.

## 6. Xác thực

Dùng lại `API_KEY` hiện có. Chấp nhận **cả hai** cách gửi:

```
x-api-key: <API_KEY>
Authorization: Bearer <API_KEY>
```

Lý do nhận thêm `Authorization`: nhiều client MCP chỉ cho điền một ô token duy nhất và
tự đặt nó vào `Authorization`. Đây là mở rộng của macro `apiKey` trong `src/guards/`,
áp dụng cho cả HTTP API — không có hại, và bớt một cách để cấu hình sai.

Macro `needsToken` giữ nguyên: chưa đọc được CLI token của 9Router thì `/mcp` trả 503
như mọi route khác.

Sai key trả HTTP 401 trước khi chạm JSON-RPC. Đây là lỗi tầng vận chuyển, không phải
lỗi tool — client MCP cần thấy 401 để biết mà sửa cấu hình.

### 6.1 Về DNS rebinding

Spec MCP khuyến nghị server HTTP chạy local kiểm header `Origin` để chặn trang web bất
kỳ gọi vào `localhost`. Ở đây phòng thủ đã có sẵn: cả `x-api-key` lẫn `Authorization`
đều là non-simple header, mà server không phát bất kỳ header CORS nào, nên preflight
của trình duyệt thất bại trước khi request thật được gửi. Không thêm code kiểm `Origin`;
ghi lại lập luận ở đây để lần sau không ai phải suy lại từ đầu.

Điều này không thay cho cảnh báo sẵn có trong `README.md`: server nắm CLI token có toàn
quyền dashboard 9Router, đừng expose ra Internet công cộng.

## 7. Lỗi

Phân biệt rạch ròi hai loại:

**Lỗi protocol** → JSON-RPC error. Body không parse được, method không tồn tại, tham số
sai schema. SDK tự lo phần lớn.

**Lỗi nghiệp vụ** → kết quả tool bình thường với `isError: true` và text đọc được. Model
cần đọc được lý do để tự xử lý, thay vì đứt luồng.

| Tình huống | Trả về |
|---|---|
| `connection_id` không có trong snapshot | `isError: true` + nêu rõ id đó không có, gợi ý gọi `list_quotas` |
| Đang trong cooldown refresh | `isError: true` + "thử lại sau N giây" |
| Chưa đọc được CLI token | HTTP 503, không phải lỗi tool |
| Sai `API_KEY` | HTTP 401, không phải lỗi tool |

Trường hợp cooldown đáng nói riêng. `quotaService.refreshOne` trả
`{ kind: "cooldown", retryAfterSeconds }`; con số đó phải đi vào text. Model biết còn
bao lâu thì đợi; model không biết thì gọi lại ngay — và đó chính là kiểu tải mà cả hàng
đợi lẫn cooldown sinh ra để chặn.

## 8. Cấu trúc file

```
src/mcp/
  index.ts     barrel — createMcpRoutes(deps)
  server.ts    dựng McpServer, đăng ký tool, gắn WebStandardStreamableHTTPServerTransport
  tools.ts     schema input + handler gọi quotaService
  format.ts    QuotaEntry[] → Markdown
```

`format.ts` không biết gì về MCP lẫn HTTP — vào `QuotaEntry[]`, ra `string`. Test được
bằng bảng dữ liệu thuần, không cần dựng server. Đây là nơi chứa gần như toàn bộ chi
tiết dễ sai của §5, nên nó phải là nơi dễ test nhất.

`tools.ts` không biết gì về `SnapshotStore` hay `Poller` — chỉ thấy `quotaService`.

### 8.1 Refactor kèm theo: nhấc `guards` ra khỏi `http`

`createGuards` đang nằm ở `src/http/guards.ts`. `src/mcp/` cần đúng hai macro đó. Nếu
để nguyên, `mcp/` phải import xuyên thẳng vào một file cụ thể của miền khác, phá quy
ước "mỗi miền có `index.ts` barrel, nơi khác import qua đường dẫn thư mục" mà spec gốc
(§3.2) đặt ra. Cho `http/index.ts` re-export rồi `mcp/` import qua đó thì thành vòng,
vì `http/index.ts` cũng phải mount `mcp/`.

Chuyển `src/http/guards.ts` → `src/guards/index.ts`. Sửa 3 dòng import trong
`http/quotas.ts`, `http/refresh.ts`, `http/health.ts` (`TOKEN_HINT`). Không đổi hành vi.

`src/http/index.ts` vẫn là nơi ghép mọi mặt tiền HTTP, gồm cả
`.use(createMcpRoutes(...))` — `src/index.ts` không cần biết MCP tồn tại.

## 9. Test

Theo đúng bố cục `tests/` hiện có, thêm `tests/mcp/`.

| File | Kiểm |
|---|---|
| `tests/mcp/format.test.ts` | Toàn bộ bảng quy tắc §5.1: `unlimited`, `total` null, `stale`, mỗi `status`, `quotas` rỗng, danh sách rỗng sau lọc |
| `tests/mcp/tools.test.ts` | Handler với `quotaService` giả: lọc đúng, `notFound` → `isError`, `cooldown` → `isError` có kèm số giây, `refresh_quota` gọi `refreshOne` với `force === false` |
| `tests/mcp/server.test.ts` | Dựng Elysia thật, POST tuần tự `initialize` → `tools/list` → `tools/call` bằng JSON-RPC thô. Cộng: thiếu key → 401, key ở `Authorization: Bearer` → 200 |

`server.test.ts` là test đáng giá nhất. Hai file kia chứng minh hàm chạy đúng;
`server.test.ts` chứng minh dây protocol thật sự thông — mà đó mới là thứ hỏng thì
không client nào dùng được.

Kiểm rằng `force` không lọt: assert trên schema `tools/list` trả về, không chỉ trên
handler. Schema mới là thứ model nhìn thấy.

## 10. Cấu hình và tài liệu

Không thêm biến môi trường. Không có cờ bật/tắt MCP: một endpoint đã guard bằng
`API_KEY` không cần thêm công tắc, và mỗi công tắc là một trạng thái nữa phải test.

`package.json` thêm đúng một dependency trực tiếp:
`"@modelcontextprotocol/server": "2.0.0"` — pin chính xác, không `^`.

`README.md` thêm một mục MCP: bảng ba tool, và lệnh đăng ký thật:

```bash
claude mcp add --transport http 9router-quota http://localhost:20129/mcp \
  --header "x-api-key: $API_KEY"
```

`docs/HTTP-API.md` không đổi — nó tài liệu hoá API của 9Router, không phải của server này.

## 11. Rủi ro và đánh đổi

**`@modelcontextprotocol/server@2.0.0` là bản viết lại lớn, vừa phát hành.** API v2 khác
v1 đáng kể (tách package, bỏ `SSEServerTransport`, transport theo runtime). Pin chính
xác phiên bản. `tests/mcp/server.test.ts` là lưới an toàn khi nâng cấp: nó nói chuyện
bằng JSON-RPC thô nên không phụ thuộc API của SDK, và sẽ gãy đúng lúc nếu hành vi trên
dây đổi.

**Thêm `zod@4` vào một project đang có đúng một runtime dependency.** `zod` là dep bắc
cầu của SDK và chỉ dùng trong `src/mcp/`. Phần còn lại giữ TypeBox (`t`) của Elysia.
Chấp nhận hai hệ schema trong một repo, ranh giới rõ theo thư mục — đổi lại không phải
tự bảo trì tính đúng đắn của protocol.

**Model vẫn có thể gọi `refresh_quota` liên tục cho nhiều connection khác nhau**, vì
cooldown tính riêng từng connection. Hàng đợi một worker có delay đã chặn fan-out song
song, nên trần thiệt hại là một chuỗi tuần tự — đúng cái mà `docs/HTTP-API.md` yêu cầu.
Không thêm rate limit toàn cục lúc này; nếu thực tế cần, chỗ đặt là `quotaService`, để
HTTP API hưởng chung.

**Định dạng Markdown tốn token hơn dòng phẳng.** Đã cân nhắc và chấp nhận: vẫn rẻ hơn
JSON, và là thứ người xem đọc được ngay khi client render.
