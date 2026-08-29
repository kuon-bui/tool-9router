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

Mặc định `x-api-key` phải khớp `API_KEY` tĩnh trong `.env`. Bật
`ALLOW_ROUTER_API_KEYS=true` để cho phép thêm: bất kỳ key nào đang
`isActive: true` trong danh sách `GET /api/keys` của chính 9Router cũng đăng
nhập được — additive, không thay thế `API_KEY`. Danh sách này được cache
trong RAM theo `ROUTER_API_KEYS_CACHE_TTL_MS` (mặc định 30s); nếu gọi sang
9Router thất bại lúc cần xác minh, request bị từ chối (401) thay vì dùng
danh sách cache cũ.

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
