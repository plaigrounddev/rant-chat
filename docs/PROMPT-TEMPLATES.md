# Prompt Templates

> Available pre-built personas for the RantChat agent.

## How Templates Work

Templates override the default system prompt with a tailored identity, context, and exit conditions. Select a template from the UI or pass `templateSlug` in the API request body.

## Available Templates

### 🤖 Default — `default`
General-purpose autonomous agent. Good at everything. No overrides applied.

---

### 🔍 Research Analyst — `research-analyst`
**Category**: Research  
Deep research on companies, people, markets, and topics. Cross-references multiple sources, prioritizes official sources, includes confidence levels, and cites everything.

**Best for**: Company research, competitive analysis, market intelligence, fact-checking.

---

### 📈 Sales Development Rep — `sales-rep`
**Category**: Sales  
Qualifies leads using BANT framework, crafts personalized outreach using AIDA, and researches prospects. B2B SaaS focus.

**Best for**: Lead qualification, outreach drafts, prospect research, sales emails.

---

### 🎧 Customer Support Agent — `customer-support`
**Category**: Support  
Handles support inquiries with empathy. Troubleshoots step-by-step, provides clear next steps, and escalates when needed.

**Best for**: Ticket responses, troubleshooting guides, FAQ handling, escalation routing.

---

### 🏗️ Technical Architect — `technical-architect`
**Category**: Engineering  
Designs systems, evaluates tech stacks, and communicates decisions with tradeoff analysis. Thinks in systems.

**Best for**: Architecture decisions, tech evaluations, system design, code review guidance.

---

### ✍️ Content Strategist — `content-strategist`
**Category**: Marketing  
Creates content plans, writes SEO-optimized copy, and analyzes competitors. Data-driven creativity.

**Best for**: Blog posts, content calendars, SEO strategy, competitor content analysis.

---

### 📋 Executive Assistant — `executive-assistant`
**Category**: Operations  
Manages emails, calendar, tasks, and follow-ups. Proactive, organized, and anticipates needs.

**Best for**: Email triage, meeting prep, task management, follow-up tracking.

---

## Adding New Templates

Add a new entry to the `templates` array in `lib/agent/prompt-templates.ts`:

```typescript
{
    slug: "your-template",
    name: "Your Template Name",
    description: "Short description for the picker",
    category: "general",
    icon: "Bot",
    config: {
        identity: "You are...",
        context: "GUIDELINES:\n...",
        exitConditions: ["..."],
    },
}
```
