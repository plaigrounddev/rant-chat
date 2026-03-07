# Roadmap — P0 → P2

> Feature roadmap for RantChat, inspired by Lindy AI's architecture.

---

## 🥇 P0: Secrets Store (Encrypted API Key Storage)

**Status**: Not started  
**Effort**: ~1 day  
**Impact**: High — lets the agent save and reuse API keys securely

### What
A simple encrypted key-value store for API keys and tokens. Unlike plain memories, secrets are:
- Encrypted at rest
- Not shown in the agent's context dump (only accessible via tool call)
- Retrievable by name (e.g., `get_secret("folk_crm_api_key")`)

### Implementation
1. New file: `lib/agent/secrets.ts` — encrypted store using `crypto.createCipheriv()`
2. New skills: `store_secret` and `get_secret` in `skills.ts`
3. Secrets stored in `data/secrets.json` (gitignored)
4. Prompt update: teach the agent to use secrets for API keys

### Why
Right now, if a user gives the agent an API key, it can only store it as a plain memory — visible in context. A secrets store keeps credentials safe and reusable.

---

## 🥈 P1: Knowledge Base (RAG over User Documents)

**Status**: Not started  
**Effort**: ~3-5 days  
**Impact**: Very high — lets the agent answer from user's own documents

### What
A RAG (Retrieval-Augmented Generation) system that lets users upload documents and have the agent search them:
- Upload: PDF, DOCX, TXT, MD files
- Website crawling: add a URL and auto-index the content
- Search: semantic (meaning-based) + keyword (exact match)
- Configurable fuzziness slider

### Implementation
1. Embeddings: OpenAI `text-embedding-3-small`
2. Vector store: Start with in-memory (later migrate to pgvector or Pinecone)
3. New file: `lib/agent/knowledge.ts` — chunking, embedding, search
4. New skill: `search_knowledge` in `skills.ts`
5. Upload API: `app/api/agent/knowledge/route.ts`
6. UI: file upload component + knowledge base viewer

### Why
This is the #1 gap vs Lindy. Without it, the agent can only answer from the web — not from the user's own docs, SOPs, or internal wikis.

---

## 🥉 P2: Settings UI (Customize Agent Identity)

**Status**: Not started  
**Effort**: ~2-3 days  
**Impact**: Medium — personal agent that feels like yours

### What
A settings page where users can:
- Customize the agent's name and identity
- Set persistent context ("I prefer bullet-point responses", "My timezone is PST")
- Pre-configure memories
- Select a default prompt template
- Toggle Composio integrations on/off

### Implementation
1. New page: `app/agent/settings/page.tsx`
2. Settings store: `lib/agent/settings.ts` (persisted to `data/settings.json`)
3. Wire into `buildSystemPrompt()` to inject user-defined context
4. Template selector: dropdown with template previews

### Why
Every user's workflow is different. A customizable agent feels personal and builds trust — just like Lindy's per-agent prompt/context/memory configuration.
