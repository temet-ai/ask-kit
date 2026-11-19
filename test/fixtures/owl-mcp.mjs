// A stdio MCP server for test/smith.mjs: the owl post office. Two tools read, one sends. It refuses
// to start unless OWL_URL reached it, so the test proves smith passes the config's env through.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

if (process.env.OWL_URL !== "http://owl.example") process.exit(3);
const s = new Server({ name: "owl", version: "0" }, { capabilities: { tools: {} } });
const obj = { type: "object", properties: { id: { type: "string" } } };
s.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    { name: "get_post", description: "One letter by id: sender, recipient, status.", inputSchema: obj },
    { name: "list_posts", description: "Letters waiting at the office.", inputSchema: obj },
    { name: "send_post", description: "Send a letter by owl.", inputSchema: obj },
  ],
}));
s.setRequestHandler(CallToolRequestSchema, async (r) => ({ content: [{ type: "text", text: `${r.params.name}: ok` }] }));
await s.connect(new StdioServerTransport());
