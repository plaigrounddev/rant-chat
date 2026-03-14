// convex/http.ts
// HTTP endpoints for file uploads to Convex storage + multimodal embedding
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

const http = httpRouter();

// ── File Upload Endpoint ────────────────────────────────────────────────
// POST /upload — Accepts multipart file uploads, stores in Convex,
// triggers async multimodal embedding via Gemini Embedding 2.
http.route({
    path: "/upload",
    method: "POST",
    handler: httpAction(async (ctx, request) => {
        // CORS preflight
        const origin = request.headers.get("Origin") ?? "*";
        const corsHeaders = {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
            "Access-Control-Max-Age": "86400",
        };

        try {
            // Extract metadata from headers
            const fileName = request.headers.get("X-File-Name") ?? "unnamed";
            const mimeType = request.headers.get("Content-Type") ?? "application/octet-stream";
            const userId = request.headers.get("X-User-Id");
            const namespace = request.headers.get("X-Namespace") ?? "global";

            if (!userId) {
                return new Response(
                    JSON.stringify({ error: "X-User-Id header is required" }),
                    { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
                );
            }

            // Validate MIME type
            const supportedTypes = [
                "image/png", "image/jpeg",
                "application/pdf",
                "video/mpeg", "video/mp4",
                "audio/mp3", "audio/wav", "audio/mpeg",
                "text/plain", "text/markdown",
            ];

            if (!supportedTypes.includes(mimeType)) {
                return new Response(
                    JSON.stringify({
                        error: `Unsupported file type: ${mimeType}`,
                        supported: supportedTypes,
                    }),
                    { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
                );
            }

            // Store the file in Convex storage
            const blob = await request.blob();
            const storageId = await ctx.storage.store(blob);

            // Register the file upload record
            const fileId = await ctx.runMutation(internal.embeddedFiles.registerFileUpload, {
                userId: userId as any,
                fileName,
                mimeType,
                storageId,
            });

            // Trigger async embedding
            await ctx.scheduler.runAfter(0, internal.embeddings.embedMultimodalFile, {
                fileId,
                storageId,
                fileName,
                mimeType,
                namespace,
            });

            return new Response(
                JSON.stringify({
                    success: true,
                    fileId,
                    storageId,
                    status: "pending",
                    message: `File "${fileName}" uploaded. Embedding in progress...`,
                }),
                { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : "Upload failed";
            console.error("[http] Upload error:", message);
            return new Response(
                JSON.stringify({ error: message }),
                { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
        }
    }),
});

// ── CORS Preflight ──────────────────────────────────────────────────────
http.route({
    path: "/upload",
    method: "OPTIONS",
    handler: httpAction(async (_, request) => {
        const origin = request.headers.get("Origin") ?? "*";
        return new Response(null, {
            status: 204,
            headers: {
                "Access-Control-Allow-Origin": origin,
                "Access-Control-Allow-Methods": "POST, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type, Authorization, X-File-Name, X-User-Id, X-Namespace",
                "Access-Control-Max-Age": "86400",
            },
        });
    }),
});

export default http;
