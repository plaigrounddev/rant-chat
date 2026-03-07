/**
 * Inngest Serve Endpoint
 *
 * Registers all workflow functions with Inngest.
 * This is the single API endpoint that Inngest uses to invoke functions.
 */

import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";

// Import all workflow functions
import { deepResearch } from "@/lib/inngest/workflows/deep-research";
import { codeGeneration } from "@/lib/inngest/workflows/code-generation";
import { reviewDocument } from "@/lib/inngest/workflows/review-document";
import { buildApp } from "@/lib/inngest/workflows/build-app";
import { processData } from "@/lib/inngest/workflows/process-data";
import { monitorService } from "@/lib/inngest/workflows/monitor-service";
import { agentTeam } from "@/lib/inngest/workflows/agent-team";

export const { GET, POST, PUT } = serve({
    client: inngest,
    functions: [
        deepResearch,
        codeGeneration,
        reviewDocument,
        buildApp,
        processData,
        monitorService,
        agentTeam,
    ],
});
