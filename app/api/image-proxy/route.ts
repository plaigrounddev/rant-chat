/**
 * Image Proxy — Fetches external images server-side to bypass CORS/ORB restrictions.
 *
 * Usage: /api/image-proxy?url=<encoded-url>
 *
 * When the agent embeds images via markdown ![alt](url), the browser may block
 * cross-origin image loads (ORB/CORS). This proxy fetches them server-side and
 * serves them from the same origin, avoiding browser restrictions.
 *
 * On failure, returns a styled placeholder SVG instead of an error — this
 * prevents Streamdown from showing "Image not available" text.
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

/**
 * Generate a styled placeholder SVG when the proxy can't fetch the image.
 * This returns a valid image so Streamdown's onLoad fires (not onError),
 * preventing the "Image not available" fallback text.
 */
function placeholderSVG(domain: string, reason: string): Response {
    // Truncate domain for display
    const displayDomain = domain.length > 30 ? domain.slice(0, 27) + "…" : domain;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="80" viewBox="0 0 400 80">
  <rect width="400" height="80" rx="8" fill="#1a1a2e"/>
  <rect x="1" y="1" width="398" height="78" rx="7" fill="none" stroke="#333" stroke-width="1"/>
  <text x="20" y="32" font-family="system-ui,sans-serif" font-size="13" fill="#888">
    <tspan>📷</tspan>
    <tspan dx="6" fill="#aaa">Image from</tspan>
    <tspan dx="4" fill="#7c8aff" font-weight="500">${escapeXml(displayDomain)}</tspan>
  </text>
  <text x="20" y="56" font-family="system-ui,sans-serif" font-size="11" fill="#666">${escapeXml(reason)}</text>
</svg>`;

    return new Response(svg, {
        status: 200,
        headers: {
            "Content-Type": "image/svg+xml",
            "Cache-Control": "public, max-age=3600",
        },
    });
}

function escapeXml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

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
            // Return placeholder instead of error — prevents "Image not available"
            return placeholderSVG(
                parsed.hostname,
                `Could not load — ${response.status} ${response.statusText}`
            );
        }

        const contentType = response.headers.get("content-type")?.split(";")[0].trim() ?? "";

        // Validate content type — must be an image
        if (!ALLOWED_TYPES.has(contentType) && !contentType.startsWith("image/")) {
            return placeholderSVG(parsed.hostname, "Response was not an image");
        }

        // Check content length if available
        const contentLength = response.headers.get("content-length");
        if (contentLength && parseInt(contentLength) > MAX_SIZE) {
            return placeholderSVG(parsed.hostname, "Image too large (max 10MB)");
        }

        const buffer = await response.arrayBuffer();

        if (buffer.byteLength > MAX_SIZE) {
            return placeholderSVG(parsed.hostname, "Image too large (max 10MB)");
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
        const reason = error instanceof Error ? error.message : "Connection failed";
        return placeholderSVG(parsed.hostname, reason);
    }
}
