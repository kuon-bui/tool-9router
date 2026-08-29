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
