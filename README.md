# The Brain Wrapper

A local UI for chatting with SME agents and orchestrators directly, or through Brain MCP tools selected by a local Ollama model.

## Run with Docker (recommended)

1. Start Brain from the Brain project directory:

   ```powershell
   docker compose up -d
   ```

2. Allow the wrapper origin in the Brain project's `.env`:

   ```env
   EXTERNAL_API_ORIGINS=http://localhost:3100
   ```

   Rebuild the Brain backend after changing this value:

   ```powershell
   docker compose up -d --build backend
   ```

3. From this repository, build and start the wrapper:

   ```powershell
   docker compose up -d --build
   ```

4. Open [http://localhost:3100](http://localhost:3100), choose **Use SME** or **Use Orchestrator**, enter that agent's ID, and chat. Choose **Use MCP** to ask natural-language questions; Ollama selects Brain tools and the active tool is highlighted during the call. Brain's frontend stays at [http://localhost:3000](http://localhost:3000), its API at [http://localhost:8000](http://localhost:8000), and MCP at [http://localhost:8001/mcp](http://localhost:8001/mcp).

To stop the wrapper, run `docker compose down` from this repository. This does not stop Brain's Compose services.

## Run locally without Docker

```powershell
npm install
npm run dev
```

The API URL defaults to `http://localhost:8000/api`. For local `npm run dev`, set `BRAIN_MCP_URL=http://localhost:8001/mcp`, `OLLAMA_BASE_URL=http://localhost:11434`, and `OLLAMA_CHAT_MODEL=qwen3:8b` in `.env.local`. Docker Compose attaches Wrapper to Brain's `brain_default` network and uses `http://mcp:8001/mcp` internally; it connects to host Ollama at `http://host.docker.internal:11434`. Start Brain and Ollama first. The model and MCP calls run on the Wrapper server, so the browser does not need direct CORS access to MCP or Ollama. No bearer token is used in this local setup. Chat history and tool activity are kept in the active browser session; follow-up tool calls receive prior answers and tool results as context.

Orchestrator chat uses `POST /api/orchestrators/chat`; its trace and SME replies can be opened from the info button. The Wrapper keeps the orchestrator session ID in this browser and restores its persisted messages when reconnecting. MCP chat discovers tool schemas for each turn, allows up to six model-directed tool rounds, streams tool activity into the conversation, and includes previous tool results as context for follow-up questions.
