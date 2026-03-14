// convex/convex.config.ts
import workflow from "@convex-dev/workflow/convex.config.js";
import agent from "@convex-dev/agent/convex.config.js";
import rag from "@convex-dev/rag/convex.config.js";
import { defineApp } from "convex/server";

const app = defineApp();
app.use(workflow);
app.use(agent);
app.use(rag);

export default app;
