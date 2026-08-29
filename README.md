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
