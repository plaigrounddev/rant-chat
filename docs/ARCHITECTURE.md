# RantChat Architecture

> Internal reference for the Rant Chat autonomous agent system.

## System Overview

```
┌─────────── Client (Next.js) ───────────┐
│  agent-chat.tsx ──→ useAgentChat.ts     │
│        ↕ SSE                            │
│  /api/agent/route.ts (server)           │
│        ↕ WebSocket                      │
│  OpenAI Responses API (gpt-4o)          │
│        ↕                                │
│  Tool Execution                         │
│  ├── Custom Skills (skills.ts)          │
│  │   ├── scrape_website                 │
│  │   ├── http_request                   │
│  │   ├── run_code                       │
│  │   ├── memory CRUD                    │
│  │   └── discover_integration           │
│  ├── OpenAI Built-in (web_search)       │
│  └── Composio Meta Tools (1000+ apps)   │
│       ├── COMPOSIO_SEARCH_TOOLS         │
│       ├── COMPOSIO_MANAGE_CONNECTIONS   │
│       ├── COMPOSIO_MULTI_EXECUTE_TOOL   │
│       ├── COMPOSIO_REMOTE_WORKBENCH     │
│       └── COMPOSIO_REMOTE_BASH_TOOL     │
└─────────────────────────────────────────┘
```

## Key Files

| File | Purpose |
|------|---------|
| `app/api/agent/route.ts` | Server-side agent loop. Opens WebSocket to OpenAI, runs tool calls, streams SSE to client |
| `lib/agent/skills.ts` | Skills Registry — all custom tool definitions and executors |
| `lib/agent/tools.ts` | Tool configuration — merges built-in + custom + Composio tools |
| `lib/agent/prompts.ts` | System prompt builder — identity, capabilities, memory injection |
| `lib/agent/prompt-templates.ts` | Pre-built persona templates (Research, Sales, Support, etc.) |
| `lib/agent/memory.ts` | Persistent memory store (survives across conversations) |
| `lib/agent/composio.ts` | Composio integration — 1000+ app tools via 5 meta tools |
| `lib/agent/task-store.ts` | Task monitoring — tracks runs, steps, and status |
| `app/agent/agent-chat.tsx` | Client-side chat UI with tool call cards |
| `app/agent/useAgentChat.ts` | Client-side hook for SSE streaming and state management |

## Data Flow

1. **User sends message** → `useAgentChat.ts` POSTs to `/api/agent`
2. **Server builds prompt** → `prompts.ts` creates system prompt with memories, skills, template
3. **WebSocket to OpenAI** → `route.ts` opens WS to `wss://api.openai.com/v1/responses`
4. **Tool loop** → OpenAI responds with tool calls → server executes → sends results back
5. **SSE streaming** → Each step streamed to client as SSE events
6. **Client renders** → `agent-chat.tsx` renders messages, tool cards, and status

## Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `OPENAI_API_KEY` | ✅ | OpenAI API access |
| `COMPOSIO_API_KEY` | Optional | Composio 1000+ integrations |

## Multi-Tenancy Readiness

> **This app will become multi-tenant.** All data stores are designed with swappable backends.

| Store | Current Backend | Multi-Tenant Migration |
|-------|----------------|----------------------|
| `secretsStore` | `data/secrets.json` | DB table with `user_id` + encryption per tenant |
| `memoryStore` | `data/memories.json` | DB table with `user_id` |
| `taskStore` | In-memory Map | DB table with `user_id` + task history |
| Prompt templates | In-code array | DB table for custom per-user/org templates |
| Settings | Not built yet | DB table with `user_id` |

**Migration path**: The store interfaces (`.store()`, `.get()`, `.list()`, `.delete()`) stay the same. Swap the file I/O implementation for DB queries (e.g., Supabase, Postgres). No skill or prompt code changes needed.

