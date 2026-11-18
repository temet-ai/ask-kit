// A two-tool MCP server for test/kits.mjs: `echo` returns its arguments and the session it acts as.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
const s = new McpServer({ name: "fake", version: "0" });
s.registerTool("echo", { description: "Echo the arguments.", inputSchema: { text: z.string().describe("what to echo"), from: z.string().optional() } }, async (a) => ({ content: [{ type: "text", text: JSON.stringify({ ...a, env: process.env.FAKE_CALLER ?? null }) }] }));
s.registerTool("hidden", { description: "Not allowed.", inputSchema: {} }, async () => ({ content: [{ type: "text", text: "no" }] }));
await s.connect(new StdioServerTransport());
