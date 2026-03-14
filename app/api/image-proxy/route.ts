/**
 * Image Proxy — Fetches external images server-side to bypass CORS/ORB restrictions.
 *
 * Usage: /api/image-proxy?url=<encoded-url>
 *
 * When the agent embeds images via markdown ![alt](url), the browser may block
 * cross-origin image loads (ORB/CORS). This proxy fetches them server-side and
 * serves them from the same origin, avoiding browser restrictions.
 */

import { NextRequest, NextResponse } from "next/server";

// Allowed image MIME types
const ALLOWED_TYPES = new Set([
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "image/svg+xml",
    "image/avif",
    "image/bmp",
    "image/tiff",
]);

// Max image size: 10MB
const MAX_SIZE = 10 * 1024 * 1024;

export async function GET(request: NextRequest) {
    const url = request.nextUrl.searchParams.get("url");

    if (!url) {
        return NextResponse.json({ error: "Missing url parameter" }, { status: 400 });
    }

    // Validate URL
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
    }

    // Only allow http/https
    if (!["http:", "https:"].includes(parsed.protocol)) {
        return NextResponse.json({ error: "Only http/https URLs allowed" }, { status: 400 });
    }

    try {
        const response = await fetch(url, {
            headers: {
                // Mimic a real browser request to avoid CDN bot protection
                "User-Agent":
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
                Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
                "Accept-Encoding": "gzip, deflate, br",
                "Sec-Fetch-Dest": "image",
                "Sec-Fetch-Mode": "no-cors",
                "Sec-Fetch-Site": "cross-site",
                Referer: parsed.origin + "/",
            },
            redirect: "follow",
            signal: AbortSignal.timeout(15_000),
        });

        if (!response.ok) {
            return NextResponse.json(
                { error: `Upstream returned ${response.status}` },
                { status: 502 }
            );
        }

        const contentType = response.headers.get("content-type")?.split(";")[0].trim() ?? "";

        // Validate content type — must be an image
        if (!ALLOWED_TYPES.has(contentType) && !contentType.startsWith("image/")) {
            return NextResponse.json(
                { error: "Response is not an image" },
                { status: 415 }
            );
        }

        // Check content length if available
        const contentLength = response.headers.get("content-length");
        if (contentLength && parseInt(contentLength) > MAX_SIZE) {
            return NextResponse.json(
                { error: "Image too large (max 10MB)" },
                { status: 413 }
            );
        }

        const buffer = await response.arrayBuffer();

        if (buffer.byteLength > MAX_SIZE) {
            return NextResponse.json(
                { error: "Image too large (max 10MB)" },
                { status: 413 }
            );
        }

        return new NextResponse(buffer, {
            status: 200,
            headers: {
                "Content-Type": contentType,
                "Cache-Control": "public, max-age=86400, s-maxage=86400",
                "X-Proxy-Source": parsed.hostname,
            },
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Proxy fetch failed";
        return NextResponse.json({ error: message }, { status: 502 });
    }
}
