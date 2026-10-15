"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { ArrowRight, Brain, Boxes, LoaderCircle, MessageSquareText, Send, Waypoints, Wrench, X } from "lucide-react";
import McpWorkspace from "./mcp-workspace";

const API_BASE = (process.env.NEXT_PUBLIC_BRAIN_API_URL || "http://localhost:8000/api").replace(/\/+$/, "");
type Citation = { index: number; document_id: string; chunk_id: string; filename: string; page: number | null; heading: string | null; sme_id?: string; sme_public_id?: number; sme_name?: string };
type Agent = { sme_id: number; sme_uuid: string; sme_name: string; status: string; message: string; answer: string; citations: Citation[]; duration_ms: number };
type Trace = { steps: { id: string; label: string; status: string }[]; agents: Agent[]; synthesis: { status: string; model: string }; duration_ms: number };
type Message = { role: "user" | "assistant"; content: string; citations?: Citation[]; trace?: Trace | null };
type OrchestrationProgress = { stage: string; progress: number; completed_steps: string[]; agents: { sme_id: number; sme_name: string; status: string; message?: string; duration_ms?: number }[] };
type Mode = "sme" | "orchestrator" | "mcp";
function validId(value: string) { return /^\d{4}$/.test(value) && Number(value) >= 1000 && Number(value) <= 9999; }

export default function Home() {
  const [mode, setMode] = useState<Mode>("sme");
  const [idInput, setIdInput] = useState("");
  const [activeId, setActiveId] = useState<number | null>(null);
  const [sessionId, setSessionId] = useState<string>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [orchestrationProgress, setOrchestrationProgress] = useState<OrchestrationProgress>();
  const [traceMessage, setTraceMessage] = useState<Message | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

  function chooseMode(next: Mode) { setMode(next); setActiveId(null); setIdInput(""); setMessages([]); setSessionId(undefined); setError(""); setOrchestrationProgress(undefined); setTraceMessage(null); }
  function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!validId(idInput)) { setError(`Enter a four-digit ${mode === "sme" ? "SME" : "orchestrator"} ID from 1000 to 9999.`); return; }
    const nextId = Number(idInput); const storedSession = mode === "orchestrator" ? localStorage.getItem(`brain-wrapper:${mode}:${nextId}`) ?? undefined : undefined;
    setActiveId(nextId); setSessionId(storedSession); setMessages([]); setError(""); setOrchestrationProgress(undefined);
    if (mode === "orchestrator" && storedSession) {
      void fetch(`${API_BASE}/orchestrators/${nextId}/sessions/${storedSession}`).then((response) => response.ok ? response.json() : null).then((history) => {
        if (history?.messages) setMessages(history.messages.map((message: { role: "user" | "assistant"; content: string; citations: Citation[]; orchestration_trace: Trace | null }) => ({ role: message.role, content: message.content, citations: message.citations, trace: message.orchestration_trace })));
      }).catch(() => setError("Could not restore this conversation from the Brain API."));
    }
  }
  function changeAgent() { setActiveId(null); setIdInput(""); setMessages([]); setSessionId(undefined); setError(""); setOrchestrationProgress(undefined); setTraceMessage(null); }

  async function sendQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const text = question.trim(); if (!text || loading || activeId === null) return;
    setQuestion(""); setError(""); setLoading(true); setOrchestrationProgress(undefined); setMessages((current) => [...current, { role: "user", content: text }]);
    const progressId = mode === "orchestrator" ? crypto.randomUUID() : undefined;
    let progressFinished = false;
    const progressPolling = mode === "orchestrator" && progressId ? (async () => {
      while (!progressFinished) {
        try {
          const response = await fetch(`${API_BASE}/orchestrators/chat/progress/${activeId}/${progressId}`);
          if (response.ok) setOrchestrationProgress(await response.json() as OrchestrationProgress);
        } catch { /* Keep the request moving if a progress poll is temporarily unavailable. */ }
        await new Promise((resolve) => window.setTimeout(resolve, 750));
      }
    })() : Promise.resolve();
    try {
      const endpoint = mode === "sme" ? `${API_BASE}/chat` : `${API_BASE}/orchestrators/chat`;
      const payload = mode === "sme" ? { sme_id: activeId, question: text, session_id: sessionId ?? null } : { orchestrator_id: activeId, question: text, session_id: sessionId ?? null, progress_id: progressId };
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!response.ok) { let message = `Request failed (${response.status}).`; try { const body = await response.json(); message = body.detail ?? message; } catch { /* Non-JSON response. */ } throw new Error(message); }
      const reply = await response.json(); setSessionId(reply.session_id); if (mode === "orchestrator") localStorage.setItem(`brain-wrapper:${mode}:${activeId}`, reply.session_id);
      setMessages((current) => [...current, { role: "assistant", content: reply.answer, citations: reply.citations, trace: reply.orchestration_trace ?? null }]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not reach the Brain API."); }
    finally {
      progressFinished = true;
      await progressPolling;
      if (mode === "orchestrator" && progressId && activeId !== null) {
        try {
          const response = await fetch(`${API_BASE}/orchestrators/chat/progress/${activeId}/${progressId}`);
          if (response.ok) setOrchestrationProgress(await response.json() as OrchestrationProgress);
        } catch { /* The final answer and stored trace remain available if progress is unavailable. */ }
      }
      setLoading(false); input.current?.focus();
    }
  }

  return <div className="app-shell">
    <aside className="rail"><div className="brand"><span className="brand-mark"><Brain size={20} /></span><span className="brand-copy">The Brain<small>Agent gateway</small></span></div><div className="rail-label">Connect</div><nav className="rail-nav" aria-label="Agent types">
      <button type="button" className={`rail-link${mode === "sme" ? " active" : ""}`} onClick={() => chooseMode("sme")}><Boxes size={17} /><span>Use SME</span></button>
      <button type="button" className={`rail-link${mode === "orchestrator" ? " active" : ""}`} onClick={() => chooseMode("orchestrator")}><Waypoints size={17} /><span>Use Orchestrator</span></button>
      <button type="button" className={`rail-link${mode === "mcp" ? " active" : ""}`} onClick={() => chooseMode("mcp")}><Wrench size={17} /><span>Use MCP</span></button>
    </nav><div className="rail-foot"><i className="local-dot" /><span>Local connection</span></div></aside>
    <main className="main"><header className="topbar"><span>{mode === "sme" ? "SME agent workspace" : mode === "orchestrator" ? "Orchestrator workspace" : "MCP tool workspace"}</span><span className="local-pill">LOCAL FIRST</span></header><div className="workspace">
      {mode === "mcp" ? <McpWorkspace /> : activeId === null ? <div className="welcome"><section className="connect-card"><div className="connect-icon">{mode === "sme" ? <Boxes size={21} /> : <Waypoints size={21} />}</div><div className="eyebrow">Use a {mode === "sme" ? "subject expert" : "orchestrator"} agent</div><h1>{mode === "sme" ? "Which expert do you need?" : "Which orchestrator do you need?"}</h1><p>Enter the four-digit ID shown in The Brain. {mode === "orchestrator" ? "The orchestrator consults every linked SME and returns one synthesized answer." : "The wrapper connects to that agent through the shared chat API."}</p>
        <form onSubmit={connect}><label className="field-label" htmlFor="agent-id">{mode === "sme" ? "SME ID" : "ORCHESTRATOR ID"}</label><div className="id-entry"><input id="agent-id" inputMode="numeric" autoComplete="off" maxLength={4} pattern="[0-9]{4}" placeholder="e.g. 1000" value={idInput} onChange={(event) => { setIdInput(event.target.value.replace(/\D/g, "").slice(0, 4)); setError(""); }} /><button className="primary-button" type="submit">Connect <ArrowRight size={14} /></button></div><div className="hint">IDs are four digits, from 1000 to 9999.</div>{error && <div role="alert" className="error">{error}</div>}</form>
      </section></div> : <section className="chat-shell" aria-label={`${mode} conversation`}><header className="chat-head"><div className="agent-title"><span className="agent-icon">{mode === "sme" ? <Boxes size={17} /> : <Waypoints size={17} />}</span><div><strong>{mode === "sme" ? "SME agent" : "Orchestrator"}</strong><small>Connected to {mode === "sme" ? "SME" : "Orchestrator"} {String(activeId).padStart(4, "0")}</small></div></div><button className="change-agent" type="button" onClick={changeAgent}>Change {mode === "sme" ? "SME" : "orchestrator"}</button></header>
        <div className="chat-log">{!messages.length && <div className="chat-empty"><MessageSquareText size={22} /><strong>You’re connected</strong><span>Ask a question to start chatting with {mode === "sme" ? "this SME" : "all SMEs linked to this orchestrator"}.</span></div>}{messages.map((message, index) => <article className={`message ${message.role}`} key={`${index}-${message.role}`}><div className="bubble">{message.content}</div>
          {!!message.citations?.length && <div className="sources">{message.citations.map((citation) => <a className="source-pill source-link" key={`${citation.index}-${citation.chunk_id}`} href={citation.sme_id ? `http://localhost:3000/smes/${citation.sme_id}/documents/${citation.document_id}?chunkId=${encodeURIComponent(citation.chunk_id)}` : undefined} title={`${citation.sme_name ?? "Source"} · ${citation.filename}`}><b>[{citation.index}]</b>{citation.sme_name ? `${citation.sme_name} · ` : ""}{citation.filename}{citation.page ? ` · p. ${citation.page}` : ""}</a>)}</div>}
          {message.trace && <button type="button" className="trace-button" onClick={() => setTraceMessage(message)}>ⓘ Agent replies &amp; trace</button>}
        </article>)}{loading && mode === "orchestrator" && <div className="orchestration-progress"><div className="orchestration-progress-head"><span><LoaderCircle size={14} className="spin" />{orchestrationProgress?.stage === "synthesizing" ? "Synthesizing the SME replies" : "Consulting linked SMEs"}</span><b>{orchestrationProgress?.progress ?? 5}%</b></div><div className="orchestration-progress-track"><span style={{ width: `${orchestrationProgress?.progress ?? 5}%` }} /></div>{orchestrationProgress?.agents.map((agent) => <div className="orchestration-agent-status" key={agent.sme_id}><span>{agent.sme_name}<small>SME {String(agent.sme_id).padStart(4, "0")}</small></span><b className={`agent-status-${agent.status}`}>{agent.status === "running" ? "Responding" : agent.status === "queued" ? "Queued" : agent.status.replaceAll("_", " ")}</b>{agent.message && <small>{agent.message}</small>}</div>)}</div>}{loading && !(mode === "orchestrator" && orchestrationProgress) && <div className="waiting"><LoaderCircle size={14} className="spin" /> {mode === "orchestrator" ? "Consulting SME agents and synthesizing their answers…" : "Searching this SME and preparing a cited answer…"}</div>}{error && <div role="alert" className="error">{error}</div>}<div ref={bottom} /></div>
        <form className="composer" onSubmit={(event) => void sendQuestion(event)}><textarea ref={input} aria-label="Ask the agent" placeholder={`Ask a question about this ${mode === "sme" ? "SME" : "orchestrator"}…`} value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} maxLength={8000} /><button className="send-button" aria-label="Send question" disabled={!question.trim() || loading}><Send size={16} /></button></form>
      </section>}
      {mode !== "mcp" && <p className="notice">This wrapper sends chat requests to <code>{API_BASE}/{mode === "sme" ? "chat" : "orchestrators/chat"}</code>. Conversations are stored by Brain; orchestrator trace can be restored when reconnecting with this browser.</p>}
    </div></main>
    {traceMessage && <div className="trace-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setTraceMessage(null); }}><section className="trace-dialog" role="dialog" aria-modal="true" aria-labelledby="trace-title"><header><div><small>ORCHESTRATION DETAILS</small><h2 id="trace-title">Agent replies and trace</h2></div><button className="trace-close" aria-label="Close" onClick={() => setTraceMessage(null)}><X size={20} /></button></header><div className="trace-body"><h3>Process</h3><ol>{traceMessage.trace?.steps.map((step) => <li key={step.id}><span>{step.status}</span><b>{step.label}</b></li>)}</ol><p>Synthesis: {traceMessage.trace?.synthesis.status} · {traceMessage.trace?.synthesis.model} · {traceMessage.trace?.duration_ms} ms</p><h3>SME replies</h3>{traceMessage.trace?.agents.map((agent) => <article key={agent.sme_uuid}><header><b>{agent.sme_name}</b><span>SME {String(agent.sme_id).padStart(4, "0")} · {agent.status}{agent.duration_ms ? ` · ${agent.duration_ms} ms` : ""}</span></header>{agent.message && <p>{agent.message}</p>}{agent.answer && <p className="trace-answer">{agent.answer}</p>}{agent.citations?.map((citation) => <a key={`${citation.index}-${citation.chunk_id}`} href={`http://localhost:3000/smes/${agent.sme_uuid}/documents/${citation.document_id}?chunkId=${encodeURIComponent(citation.chunk_id)}`} target="_blank" rel="noreferrer">[{citation.index}] {citation.filename}{citation.page ? ` · p. ${citation.page}` : ""}</a>)}</article>)}</div></section></div>}
  </div>;
}
