# Composio Integration Reference

> **Source**: [docs.composio.dev](https://docs.composio.dev) — Last updated: 2026-03-04
> **Our implementation**: `lib/agent/composio.ts`

## Architecture Overview

Composio gives AI agents access to **1000+ app integrations** through **5 meta tools**.
Instead of building individual integrations (Gmail, GitHub, Slack, etc.), the agent
discovers, authenticates, and executes tools **at runtime**.

```
┌─────────────────── Our Agent ───────────────────┐
│ Custom Skills          Composio Meta Tools       │
│ ┌──────────────┐      ┌───────────────────────┐ │
│ │ web_search   │      │ COMPOSIO_SEARCH_TOOLS │ │
│ │ scrape_website│      │ COMPOSIO_MANAGE_CONN. │ │
│ │ http_request │      │ COMPOSIO_MULTI_EXEC.  │ │
│ │ run_code     │      │ COMPOSIO_REMOTE_WORK. │ │
│ │ memory CRUD  │      │ COMPOSIO_REMOTE_BASH  │ │
│ └──────────────┘      └───────┬───────────────┘ │
└───────────────────────────────┼─────────────────┘
                                │
                    ┌───────────▼───────────┐
                    │   Composio Platform   │
                    │  1000+ App Toolkits   │
                    │  Gmail, GitHub, Slack  │
                    │  Sheets, Notion, etc.  │
                    └───────────────────────┘
```

---

## SDK Setup (TypeScript)

### Packages
```bash
pnpm add @composio/core @composio/openai
```

### Initialization
```typescript
import { Composio } from "@composio/core";
import { OpenAIResponsesProvider } from "@composio/openai";

const composio = new Composio({
  apiKey: process.env.COMPOSIO_API_KEY,
  provider: new OpenAIResponsesProvider(),
});
```

### Environment
```
COMPOSIO_API_KEY=your_key_from_https://platform.composio.dev/settings
```

---

## Users & Sessions

### Users
- A **user** = an identifier from YOUR app (e.g., `"user_123"`, email, database ID)
- Connections (OAuth, API keys) are stored **per user**
- Connections are **fully isolated** between user IDs
- All tool executions use the user ID for auth context

### Sessions
- A **session** = an ephemeral configuration scoped to a user
- Created via `composio.create(userId)`
- Defines: which user, which toolkits enabled, what auth to use

```typescript
const session = await composio.create("user_123");

// Session methods:
const tools = await session.tools();           // Get meta tools
const toolkits = await session.toolkits();     // List toolkits + status
const connReq = await session.authorize("github"); // Auth a toolkit
const mcpUrl = session.mcp.url;               // MCP server URL
```

### Session Behavior
- Sessions are **immutable** — create a new one for different config
- Connected accounts **persist across sessions** — user authenticates once
- Meta tool calls within a session share context via `session_id`

---

## The 5 Meta Tools

| # | Tool | Purpose |
|---|------|---------|
| 1 | `COMPOSIO_SEARCH_TOOLS` | Discover tools by task description |
| 2 | `COMPOSIO_MANAGE_CONNECTIONS` | Create auth links for OAuth/API key |
| 3 | `COMPOSIO_MULTI_EXECUTE_TOOL` | Execute any discovered tool |
| 4 | `COMPOSIO_REMOTE_WORKBENCH` | Python sandbox for bulk operations |
| 5 | `COMPOSIO_REMOTE_BASH_TOOL` | Bash commands (jq, awk, sed, grep) |

### COMPOSIO_SEARCH_TOOLS Returns:
- **Tools with schemas** — matching tools with slugs, descriptions, input parameters
- **Connection status** — whether the user has already authenticated
- **Execution plan** — recommended steps and common pitfalls
- **Related tools** — prerequisites, alternatives, follow-up tools

### Execution Flow:
```
User: "Create a GitHub issue for this bug"
  ↓
1. Agent calls COMPOSIO_SEARCH_TOOLS
   → Returns GITHUB_CREATE_ISSUE with input schema
   → Returns connection status: "not connected"
   → Returns execution plan and tips
  ↓
2. Agent calls COMPOSIO_MANAGE_CONNECTIONS (because not connected)
   → Returns auth link for GitHub
   → User clicks link and authenticates
  ↓
3. Agent calls COMPOSIO_MULTI_EXECUTE_TOOL
   → Executes GITHUB_CREATE_ISSUE with arguments
   → Returns the created issue details
  ↓
Done. (For large results, agent can use REMOTE_WORKBENCH to process)
```

### Processing Large Results
- **COMPOSIO_REMOTE_WORKBENCH** — Python sandbox for bulk ops (e.g., labeling 100 emails),
  data transforms, or analysis with `invoke_llm` helper
- **COMPOSIO_REMOTE_BASH_TOOL** — Simpler file operations with `jq`, `awk`, `sed`, `grep`

---

## Toolkits & Tools

### Naming Convention
- **Toolkit** = a collection of related tools for a service (e.g., `github`)
- **Tool** = an individual action: `{TOOLKIT}_{ACTION}` (e.g., `GITHUB_CREATE_ISSUE`)

### Popular Toolkits
| Toolkit | Example Tools |
|---------|---------------|
| `gmail` | `GMAIL_SEND_EMAIL`, `GMAIL_SEARCH_EMAILS`, `GMAIL_GET_EMAIL` |
| `google_calendar` | `GOOGLE_CALENDAR_CREATE_EVENT`, `GOOGLE_CALENDAR_LIST_EVENTS` |
| `google_sheets` | `GOOGLE_SHEETS_APPEND_ROW`, `GOOGLE_SHEETS_READ_RANGE` |
| `github` | `GITHUB_CREATE_ISSUE`, `GITHUB_STAR_REPO`, `GITHUB_CREATE_PR` |
| `slack` | `SLACK_SEND_MESSAGE`, `SLACK_CREATE_CHANNEL` |
| `notion` | `NOTION_CREATE_PAGE`, `NOTION_UPDATE_PAGE` |
| `google_docs` | `GOOGLE_DOCS_CREATE`, `GOOGLE_DOCS_APPEND_TEXT` |
| `trello` | `TRELLO_CREATE_CARD`, `TRELLO_LIST_BOARDS` |
| `jira` | `JIRA_CREATE_ISSUE`, `JIRA_SEARCH_ISSUES` |
| `salesforce` | `SALESFORCE_CREATE_LEAD`, `SALESFORCE_SEARCH` |
| `hubspot` | `HUBSPOT_CREATE_CONTACT`, `HUBSPOT_SEARCH_CONTACTS` |
| `twitter` | `TWITTER_POST_TWEET`, `TWITTER_SEARCH_TWEETS` |
| `linkedin` | `LINKEDIN_CREATE_POST` |
| `airtable` | `AIRTABLE_CREATE_RECORD`, `AIRTABLE_LIST_RECORDS` |
| `tavily` | `TAVILY_SEARCH` (web search) |

### Authentication
- Tools execute with the **user's authenticated credentials**
- If not connected, agent uses `COMPOSIO_MANAGE_CONNECTIONS` to prompt
- Composio uses **Composio-managed auth configs** by default (their OAuth app)
- For production, create **custom auth configs** with your own OAuth credentials

---

## OpenAI Integration (Our Setup)

### Provider: `OpenAIResponsesProvider`

This is the correct provider for OpenAI Responses/WebSocket API.

```typescript
import { OpenAIResponsesProvider } from "@composio/openai";
```

### Key Methods on the Provider

| Method | Signature | Use |
|--------|-----------|-----|
| `wrapTool(tool)` | `Tool → OpenAiTool` | Convert single Composio tool to OpenAI format |
| `wrapTools(tools)` | `Tool[] → OpenAiTool[]` | Convert multiple tools |
| `executeToolCall(userId, toolCall)` | `(string, ResponseFunctionToolCall) → Promise<string>` | **Execute a single tool call** |
| `handleToolCalls(userId, output)` | `(string, ResponseOutputItem[]) → Promise<FunctionCallOutput[]>` | Execute all tool calls from a response |
| `handleResponse(userId, response)` | `(string, Response) → Promise<FunctionCallOutput[]>` | Execute all tool calls from full response object |

### Tool Format (OpenAI Responses API)
```typescript
// What session.tools() returns (with OpenAIResponsesProvider):
{
  type: "function",
  name: "COMPOSIO_SEARCH_TOOLS",
  description: "Search for tools by task...",
  parameters: { type: "object", properties: {...}, required: [...] }
}
```

### ⚠️ CRITICAL: How to Execute Tool Calls

**CORRECT** — Use the provider:
```typescript
const result = await provider.executeToolCall(userId, {
  type: "function_call",
  call_id: callId,
  name: toolName,
  arguments: JSON.stringify(args),
  id: callId,
  status: "completed",
});
```

**WRONG** — These DO NOT exist:
```typescript
// ❌ session.executeTool() — does NOT exist
// ❌ session.executeToolCall() — does NOT exist
// ❌ composio.execute() — NOT for sessions
```

---

## Sessions vs Direct Execution

### Sessions (what we use)
- `composio.create(userId)` → returns meta tools
- Agent discovers tools at runtime via `COMPOSIO_SEARCH_TOOLS`
- Auth handled in-chat via `COMPOSIO_MANAGE_CONNECTIONS`
- Best for: chat agents, dynamic tool usage

### Direct Execution (alternative)
- `composio.tools.get(userId, { tools: [...] })` → returns specific tool schemas
- `composio.tools.execute(toolName, { userId, arguments: {...} })` → execute directly
- You manage auth configs and connect links yourself
- Best for: known workflows, specific integrations

```typescript
// Direct execution example:
const tools = await composio.tools.get("user_123", {
  tools: ["GITHUB_CREATE_ISSUE", "GITHUB_LIST_ISSUES"],
});

const result = await composio.tools.execute("GITHUB_CREATE_ISSUE", {
  userId: "user_123",
  arguments: { owner: "my-org", repo: "my-repo", title: "Fix login bug" },
});
```

---

## Our Implementation (`lib/agent/composio.ts`)

### How It Works
1. **Init**: Create `Composio` client with `OpenAIResponsesProvider` (singleton)
2. **Session**: `getSession(userId)` creates/caches sessions (30min TTL)
3. **Tools**: `getComposioTools()` → gets meta tools, normalizes to flat OpenAI format
4. **Merge**: In `route.ts`, we merge Composio tools with our custom skill tools
5. **Route**: `isComposioTool(name)` → route through `executeComposioTool()` via provider
6. **Execute**: `provider.executeToolCall(userId, toolCall)` — the documented API

### Key Files
| File | Role |
|------|------|
| `lib/agent/composio.ts` | Composio client, session management, tool execution |
| `app/api/agent/route.ts` | Merges Composio + custom tools, routes COMPOSIO_* calls |
| `lib/agent/prompts.ts` | System prompt with Composio capability instructions |
| `app/agent/agent-chat.tsx` | UI icons/labels for Composio meta tools |

---

## Common Pitfalls

| Problem | Cause | Fix |
|---------|-------|-----|
| `session.executeTool is not a function` | Session objects don't have this method | Use `provider.executeToolCall()` |
| `tools[N].name missing_required_parameter` | Tool in wrong format for OpenAI WS | Normalize nested `function.name` to flat `name` |
| Composio tools not appearing | `COMPOSIO_API_KEY` not set | Add key to `.env.local` |
| Auth link not shown to user | Not detecting Connect Link URLs in results | Parse tool results for auth URLs |
| `handleToolCalls` type error | Passing raw array instead of `ResponseOutputItem[]` | Cast or use `executeToolCall` per-call |

---

## Quick Reference

```typescript
// ── Get tools ────────────────────────
const session = await composio.create("user_123");
const tools = await session.tools();  // → meta tools array

// ── Execute a tool call ──────────────
const result = await provider.executeToolCall("user_123", {
  type: "function_call",
  call_id: "call_abc",
  name: "COMPOSIO_SEARCH_TOOLS",
  arguments: '{"queries":[{"use_case":"send email"}]}',
  id: "call_abc",
  status: "completed",
});

// ── Direct execution (no session) ────
const result = await composio.tools.execute("GMAIL_SEND_EMAIL", {
  userId: "user_123",
  arguments: { to: "alice@example.com", subject: "Hello", body: "Hi!" },
});
```
