import { NextResponse } from "next/server";
import { withMcpClient } from "@/lib/mcp-client";

export const runtime = "nodejs";
export const maxDuration = 300;

type ChatTurn = { role: "user" | "assistant"; content: string; tools?: { name: string; arguments: unknown; result?: unknown; isError?: boolean }[] };
type OllamaMessage = { role: "system" | "user" | "assistant" | "tool"; content: string; tool_name?: string; tool_calls?: unknown[] };
type ToolCall = { function: { name: string; arguments: Record<string, unknown> | string } };

const MODEL = process.env.OLLAMA_CHAT_MODEL || "qwen3:8b";
const OLLAMA_URL = (process.env.OLLAMA_BASE_URL || "http://localhost:11434").replace(/\/+$/, "");
const MAX_TOOL_ROUNDS = 6;
const MAX_TOOL_RESULT_CHARS = 18_000;

function emit(controller: ReadableStreamDefaultController<Uint8Array>, encoder: TextEncoder, event: Record<string, unknown>) {
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
}

function toolResultText(result: unknown) {
  const text = JSON.stringify(result);
  return text.length > MAX_TOOL_RESULT_CHARS ? `${text.slice(0, MAX_TOOL_RESULT_CHARS)}\n[Tool output truncated]` : text;
}

async function askOllama(messages: OllamaMessage[], tools?: unknown[]) {
  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, messages, ...(tools ? { tools } : {}), stream: false }),
    signal: AbortSignal.timeout(240_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Ollama request failed (${response.status}).`);
  return body.message as { content?: string; tool_calls?: ToolCall[] };
}

export async function POST(request: Request) {
  let body: { messages?: ChatTurn[] };
  try { body = await request.json(); }
  catch { return NextResponse.json({ detail: "Expected a JSON request body." }, { status: 400 }); }
  const history = body.messages?.slice(-20) ?? [];
  if (!history.length || history.at(-1)?.role !== "user" || !history.at(-1)?.content?.trim()) {
    return NextResponse.json({ detail: "A user message is required." }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        await withMcpClient(async (client) => {
          const discovered = await client.listTools();
          const toolsByName = new Map(discovered.tools.map((tool) => [tool.name, tool]));
          const ollamaTools = discovered.tools.map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description ?? tool.name, parameters: tool.inputSchema } }));
          const messages: OllamaMessage[] = [{
            role: "system",
            content: "You are The Brain assistant. Use the supplied Brain MCP tools to discover SME agents, inspect their knowledge, and chat with them. For greetings, answer briefly without calling tools. For questions about Brain agents or processed knowledge, use appropriate tools and ground answers in results. If the target agent is unclear, discover agents or ask the user to clarify. Never invent agent IDs, document facts, citations, or tool results. Preserve session_id values from prior tool results when continuing an agent conversation. Explain when tools find no supporting evidence. You may call tools in multiple rounds, up to the server limit.",
          }];
          for (const turn of history) {
            const trace = turn.role === "assistant" && turn.tools?.length
              ? `\n\nMCP tool activity from this turn:\n${turn.tools.map((item) => `${item.name}(${JSON.stringify(item.arguments)}) => ${toolResultText(item.result ?? (item.isError ? "Tool failed" : null))}`).join("\n")}`
              : "";
            messages.push({ role: turn.role, content: `${turn.content}${trace}` });
          }

          emit(controller, encoder, { type: "status", stage: "deciding", message: "Deciding whether Brain tools can help…" });
          for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
            const response = await askOllama(messages, ollamaTools);
            const calls = response.tool_calls ?? [];
            if (!calls.length) {
              emit(controller, encoder, { type: "answer", content: response.content?.trim() || "I could not produce an answer. Please try rephrasing your question." });
              return;
            }
            messages.push({ role: "assistant", content: response.content ?? "", tool_calls: calls });
            for (const [index, call] of calls.entries()) {
              const name = call.function.name;
              const callId = `${round}-${index}-${crypto.randomUUID()}`;
              let args: Record<string, unknown> = {};
              try {
                args = typeof call.function.arguments === "string" ? JSON.parse(call.function.arguments) : call.function.arguments ?? {};
                emit(controller, encoder, { type: "tool_start", callId, name, arguments: args, round: round + 1 });
                if (!toolsByName.has(name)) throw new Error(`The model selected an unavailable MCP tool: ${name}`);
                const result = await client.callTool({ name, arguments: args });
                emit(controller, encoder, { type: "tool_result", callId, name, arguments: args, result, isError: result.isError ?? false });
                messages.push({ role: "tool", tool_name: name, content: toolResultText(result) });
              } catch (error) {
                const message = error instanceof Error ? error.message : "MCP tool call failed.";
                emit(controller, encoder, { type: "tool_result", callId, name, arguments: args, result: message, isError: true });
                messages.push({ role: "tool", tool_name: name, content: `Tool error: ${message}` });
              }
            }
            emit(controller, encoder, { type: "status", stage: "deciding", message: "Using tool results to prepare your answer…" });
          }
          emit(controller, encoder, { type: "status", stage: "finalizing", message: "Preparing a final answer from the available results…" });
          const final = await askOllama(messages);
          emit(controller, encoder, { type: "answer", content: final.content?.trim() || "I reached the tool-call limit before producing a final answer. Please narrow the request and try again." });
        });
      } catch (error) {
        emit(controller, encoder, { type: "error", message: error instanceof Error ? error.message : "MCP chat failed." });
      } finally { controller.close(); }
    },
  });

  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
}
