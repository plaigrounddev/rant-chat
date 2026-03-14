// app/api/embed/route.ts
// Next.js API route that proxies file uploads to Convex HTTP endpoint
// Handles auth validation and forwards to the Convex upload endpoint

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

// Supported MIME types matching Gemini Embedding 2 capabilities
const SUPPORTED_TYPES = new Set([
    // Images
    "image/png", "image/jpeg",
    // Documents
    "application/pdf",
    // Video
    "video/mpeg", "video/mp4",
    // Audio
    "audio/mp3", "audio/wav", "audio/mpeg",
    // Text
    "text/plain", "text/markdown",
]);

// Max file sizes per modality (bytes)
const MAX_SIZES: Record<string, number> = {
    "image/png": 20 * 1024 * 1024,     // 20MB
    "image/jpeg": 20 * 1024 * 1024,    // 20MB
    "application/pdf": 50 * 1024 * 1024, // 50MB
    "video/mpeg": 100 * 1024 * 1024,   // 100MB
    "video/mp4": 100 * 1024 * 1024,    // 100MB
    "audio/mp3": 50 * 1024 * 1024,     // 50MB
    "audio/wav": 50 * 1024 * 1024,     // 50MB
    "audio/mpeg": 50 * 1024 * 1024,    // 50MB
    "text/plain": 10 * 1024 * 1024,    // 10MB
    "text/markdown": 10 * 1024 * 1024, // 10MB
};

export async function POST(request: NextRequest) {
    try {
        // Verify authentication
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 },
            );
        }

        const formData = await request.formData();
        const file = formData.get("file") as File | null;
        const namespace = (formData.get("namespace") as string) || userId;

        if (!file) {
            return NextResponse.json(
                { error: "No file provided" },
                { status: 400 },
            );
        }

        // Validate MIME type
        if (!SUPPORTED_TYPES.has(file.type)) {
            return NextResponse.json(
                {
                    error: `Unsupported file type: ${file.type}`,
                    supported: Array.from(SUPPORTED_TYPES),
                },
                { status: 400 },
            );
        }

        // Validate file size
        const maxSize = MAX_SIZES[file.type] ?? 20 * 1024 * 1024;
        if (file.size > maxSize) {
            return NextResponse.json(
                {
                    error: `File too large: ${(file.size / 1024 / 1024).toFixed(1)}MB exceeds ${(maxSize / 1024 / 1024).toFixed(0)}MB limit for ${file.type}`,
                },
                { status: 400 },
            );
        }

        // Forward to Convex HTTP endpoint
        const convexSiteUrl = process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
        if (!convexSiteUrl) {
            return NextResponse.json(
                { error: "Convex site URL not configured" },
                { status: 500 },
            );
        }

        const fileBuffer = await file.arrayBuffer();

        const convexResponse = await fetch(`${convexSiteUrl}/upload`, {
            method: "POST",
            headers: {
                "Content-Type": file.type,
                "X-File-Name": file.name,
                "X-User-Id": userId,
                "X-Namespace": namespace,
            },
            body: fileBuffer,
        });

        const result = await convexResponse.json();

        if (!convexResponse.ok) {
            return NextResponse.json(
                { error: result.error || "Upload failed" },
                { status: convexResponse.status },
            );
        }

        return NextResponse.json({
            ...result,
            fileName: file.name,
            mimeType: file.type,
            size: file.size,
        });
    } catch (error) {
        console.error("[api/embed] Upload error:", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 },
        );
    }
}

// GET endpoint to list supported types
export async function GET() {
    return NextResponse.json({
        supportedTypes: Array.from(SUPPORTED_TYPES),
        limits: {
            images: { maxPerPrompt: 6, types: ["image/png", "image/jpeg"] },
            documents: { maxPerPrompt: 1, maxPages: 6, types: ["application/pdf"] },
            video: { maxLengthWithAudio: "80s", maxLengthWithoutAudio: "120s", types: ["video/mpeg", "video/mp4"] },
            audio: { maxLength: "80s", types: ["audio/mp3", "audio/wav"] },
        },
    });
}
