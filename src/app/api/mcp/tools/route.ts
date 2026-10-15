import { NextResponse } from "next/server";
import { withMcpClient } from "@/lib/mcp-client";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET() {
  try {
    const result = await withMcpClient((client) => client.listTools());
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not connect to the Brain MCP server.";
    return NextResponse.json({ detail: message }, { status: 502 });
  }
}
