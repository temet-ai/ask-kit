// A stdio MCP server with 40 tools for test/mcp-by-name.mjs: the Ankh-Morpork guild registry. Each
// tool takes a `guild`, a `note` and a `from`, and answers with them and its own name.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
const s = new McpServer({ name: "wide", version: "0" });
const guilds = ["assassins", "thieves", "seamstresses", "alchemists", "fools", "merchants", "beggars", "watchmen"];
for (let n = 0; n < 40; n++) {
  const g = guilds[n % guilds.length];
  s.registerTool(
    `guild_${n}_roster`,
    {
      description: `Roster of the ${g} guild, edition ${n}. Lists the members of the Ankh-Morpork ${g} guild with their ranks and the dues each one owes, newest first.`,
      inputSchema: { guild: z.string().describe(`the guild to list, here ${g}`), note: z.string().optional().describe("a note to echo back"), from: z.string().optional() },
    },
    async (a) => ({ content: [{ type: "text", text: JSON.stringify({ tool: `guild_${n}_roster`, guild: a.guild, note: a.note ?? null, from: a.from ?? null }) }] }),
  );
}
await s.connect(new StdioServerTransport());
