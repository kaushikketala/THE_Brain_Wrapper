import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const MCP_URL = process.env.BRAIN_MCP_URL || "http://localhost:8001/mcp";

export async function withMcpClient<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ name: "the-brain-wrapper", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL));
  try {
    await client.connect(transport);
    return await run(client);
  } finally {
    await client.close().catch(() => undefined);
  }
}
