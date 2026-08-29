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
