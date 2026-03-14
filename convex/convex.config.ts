// convex/convex.config.ts
import workflow from "@convex-dev/workflow/convex.config.js";
import agent from "@convex-dev/agent/convex.config.js";
import rag from "@convex-dev/rag/convex.config.js";
import selfHosting from "@convex-dev/static-hosting/convex.config";
import { defineApp } from "convex/server";

const app = defineApp();
app.use(workflow);
app.use(agent);
app.use(rag);
app.use(selfHosting);

export default app;
