"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { AlertCircle, Check, ChevronDown, Circle, LoaderCircle, MessageSquareText, RefreshCw, Send, Wrench, XCircle } from "lucide-react";

type McpTool = { name: string; description?: string; inputSchema?: { properties?: Record<string, unknown> } };
type ToolActivity = { callId: string; name: string; arguments: Record<string, unknown>; result?: unknown; status: "running" | "complete" | "failed" };
type ChatMessage = { role: "user" | "assistant"; content: string; tools?: ToolActivity[] };
type StreamEvent = { type: string; stage?: string; message?: string; callId?: string; name?: string; arguments?: Record<string, unknown>; result?: unknown; isError?: boolean; content?: string };

function resultSummary(result: unknown) {
  if (typeof result === "string") return result;
  if (result && typeof result === "object" && "content" in result) {
    const content = (result as { content?: { type: string; text?: string }[] }).content;
    const text = content?.filter((item) => item.type === "text").map((item) => item.text).join("\n");
    if (text) return text;
  }
  return JSON.stringify(result, null, 2) ?? "Tool returned no content.";
}

export default function McpWorkspace() {
  const [tools, setTools] = useState<McpTool[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [currentTools, setCurrentTools] = useState<ToolActivity[]>([]);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(true);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { void discover(); }, []);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, currentTools, status]);

  async function discover() {
    setConnecting(true); setError("");
    try {
      const response = await fetch("/api/mcp/tools", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail || "Could not discover Brain MCP tools.");
      setTools(body.tools ?? []); setConnected(true);
    } catch (cause) {
      setConnected(false);
      setError(cause instanceof Error ? cause.message : "Could not connect to Brain MCP.");
    } finally { setConnecting(false); }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = question.trim();
    if (!text || loading || !connected) return;

    const userMessage: ChatMessage = { role: "user", content: text };
    const history = [...messages, userMessage];
    setMessages(history); setQuestion(""); setError(""); setLoading(true); setCurrentTools([]); setActiveTool(null); setStatus("Connecting to Brain tools…");
    let collectedTools: ToolActivity[] = [];
    try {
      const response = await fetch("/api/mcp/chat", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: history }),
      });
      if (!response.ok || !response.body) {
        let message = `Request failed (${response.status}).`;
        try { message = (await response.json()).detail ?? message; } catch { /* Non-JSON response. */ }
        throw new Error(message);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let answer: string | null = null;
      const handleEvent = (event: StreamEvent) => {
        if (event.type === "status") setStatus(event.message || event.stage || "Working…");
        if (event.type === "tool_start" && event.name && event.callId) {
          const activity: ToolActivity = { callId: event.callId, name: event.name, arguments: event.arguments ?? {}, status: "running" };
          collectedTools = [...collectedTools, activity]; setCurrentTools(collectedTools); setActiveTool(event.name); setStatus(`Calling ${event.name}…`);
        }
        if (event.type === "tool_result" && event.callId) {
          collectedTools = collectedTools.map((item) => item.callId === event.callId ? { ...item, result: event.result, status: event.isError ? "failed" : "complete" } : item);
          setCurrentTools(collectedTools); setActiveTool(null); setStatus("Reviewing tool results…");
        }
        if (event.type === "answer") answer = event.content ?? "";
        if (event.type === "error") throw new Error(event.message || "MCP chat failed.");
      };
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const blocks = buffer.split("\n\n"); buffer = blocks.pop() ?? "";
        for (const block of blocks) {
          const data = block.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
          if (data) handleEvent(JSON.parse(data) as StreamEvent);
        }
        if (done) break;
      }
      if (buffer.trim()) {
        const data = buffer.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
        if (data) handleEvent(JSON.parse(data) as StreamEvent);
      }
      if (answer !== null) setMessages((current) => [...current, { role: "assistant", content: answer!, tools: collectedTools }]);
      else if (!collectedTools.length) throw new Error("The MCP chat ended without an answer. Try again.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "MCP chat failed.");
      if (collectedTools.length) setMessages((current) => [...current, { role: "assistant", content: "I couldn't finish that request. See the tool activity for details, then try again.", tools: collectedTools }]);
    } finally {
      setLoading(false); setActiveTool(null); setStatus(""); input.current?.focus();
    }
  }

  function renderActivities(activities: ToolActivity[]) {
    if (!activities.length) return null;
    return <div className="mcp-activities">{activities.map((activity) => <details className={`mcp-activity ${activity.status}`} key={activity.callId} open={activity.status === "running"}>
      <summary><span className="mcp-activity-state">{activity.status === "running" ? <LoaderCircle size={14} className="spin" /> : activity.status === "complete" ? <Check size={14} /> : <XCircle size={14} />}</span><b>{activity.name}</b><span className="mcp-activity-label">{activity.status === "running" ? "Running" : activity.status === "complete" ? "Complete" : "Failed"}</span><ChevronDown size={13} className="mcp-activity-chevron" /></summary>
      <div className="mcp-activity-body"><small>ARGUMENTS</small><pre>{JSON.stringify(activity.arguments, null, 2)}</pre>{activity.result !== undefined && <><small>RESULT</small><pre>{resultSummary(activity.result)}</pre></>}</div>
    </details>)}</div>;
  }

  return <section className="mcp-workspace mcp-chat-workspace">
    <header className="mcp-heading"><div><div className="eyebrow">MODEL CONTEXT PROTOCOL</div><h1>Chat with Brain</h1><p>Ask naturally. The local model chooses Brain tools and combines their results.</p></div><button type="button" className="change-agent" onClick={() => void discover()} disabled={connecting}><RefreshCw size={14} className={connecting ? "spin" : ""} /> Refresh</button></header>
    <div className={`mcp-connection ${connected ? "connected" : "disconnected"}`}><i className="local-dot" />{connecting ? "Connecting to Brain MCP…" : connected ? `Connected · ${tools.length} tools available` : "MCP server unavailable"}<code>http://localhost:8001/mcp</code></div>
    {error && <div role="alert" className="error mcp-error"><AlertCircle size={15} />{error}{!connected && <button type="button" onClick={() => void discover()}>Retry</button>}</div>}
    <div className="mcp-chat-layout">
      <section className="mcp-conversation" aria-label="Chat with Brain using MCP">
        <div className="mcp-chat-log">
          {!messages.length && !loading && <div className="mcp-chat-empty"><MessageSquareText size={24} /><b>What would you like to know?</b><span>Ask about an SME, its documents, categories, or knowledge graph. Brain’s tools will be selected as needed.</span></div>}
          {messages.map((message, index) => <article className={`mcp-message ${message.role}`} key={`${index}-${message.role}`}><div className="mcp-message-label">{message.role === "user" ? "YOU" : "THE BRAIN"}</div><div className="mcp-message-bubble">{message.content}</div>{message.role === "assistant" && message.tools && renderActivities(message.tools)}</article>)}
          {loading && <div className="mcp-live-activity"><div className="mcp-live-head"><LoaderCircle size={14} className="spin" /><span>{status || "Working…"}</span></div>{renderActivities(currentTools)}{!currentTools.length && activeTool === null && <div className="mcp-deciding"><Circle size={8} /> Waiting for the model to select a tool or answer directly</div>}</div>}
          <div ref={bottom} />
        </div>
        <form className="composer mcp-chat-composer" onSubmit={(event) => void sendMessage(event)}><textarea ref={input} aria-label="Message Brain" placeholder="Ask a question about Brain’s SME agents…" value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} maxLength={8000} disabled={!connected || loading} /><button className="send-button" aria-label="Send message" disabled={!question.trim() || loading || !connected}>{loading ? <LoaderCircle size={16} className="spin" /> : <Send size={16} />}</button></form>
      </section>
      <aside className="mcp-tools-panel"><div className="mcp-list-title">BRAIN TOOLS <span>{tools.length}</span></div><p className="mcp-tools-intro">The model chooses from these tools. The active tool is highlighted while it runs.</p>{tools.map((tool) => <div key={tool.name} className={`mcp-reference-tool${activeTool === tool.name ? " calling" : ""}${currentTools.some((activity) => activity.name === tool.name && activity.status === "complete") ? " used" : ""}`}><span className="mcp-reference-icon">{activeTool === tool.name ? <LoaderCircle size={14} className="spin" /> : <Wrench size={13} />}</span><span><b>{tool.name}</b><small>{tool.description || "Brain MCP tool"}</small></span>{activeTool === tool.name && <i>CALLING</i>}</div>)}{!tools.length && <p className="mcp-no-tools">Connect Brain MCP to discover its tools.</p>}</aside>
    </div>
  </section>;
}
