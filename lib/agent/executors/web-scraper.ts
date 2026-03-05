/**
 * Web Scraper Executor
 *
 * Mirrors Lindy AI's "Website Content Crawler" skill.
 * Fetches a URL and extracts clean text content.
 */

import { isBlockedUrl } from "./http-request";

const MAX_CONTENT_LENGTH = 8000;
const FETCH_TIMEOUT = 10000;

/**
 * Strip HTML tags and normalize whitespace to get clean text.
 */
function htmlToText(html: string): string {
    return html
        // Remove script and style blocks
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        // Remove HTML comments
        .replace(/<!--[\s\S]*?-->/g, "")
        // Convert block elements to newlines
        .replace(/<\/(p|div|h[1-6]|li|tr|br|hr)[^>]*>/gi, "\n")
        .replace(/<br\s*\/?>/gi, "\n")
        // Remove all remaining tags
        .replace(/<[^>]+>/g, " ")
        // Decode common HTML entities
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, " ")
        // Decode numeric (&#60;) and hex (&#x3C;) entities
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
        .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
        // Normalize whitespace
        .replace(/[ \t]+/g, " ")
        .replace(/\n\s*\n/g, "\n\n")
        .trim();
}

export async function scrapeUrl(url: string): Promise<string> {
    try {
        // Validate URL
        new URL(url);
    } catch {
        return JSON.stringify({ error: "Invalid URL provided" });
    }

    // SSRF protection — reject internal/localhost addresses
    if (isBlockedUrl(url)) {
        return JSON.stringify({
            error: "Requests to internal/localhost addresses are not allowed",
        });
    }

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

        const response = await fetch(url, {
            signal: controller.signal,
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (compatible; RantChatBot/1.0; +https://rantchat.app)",
                Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
        });

        clearTimeout(timeout);

        if (!response.ok) {
            return JSON.stringify({
                error: `HTTP ${response.status}: ${response.statusText}`,
            });
        }

        const contentType = response.headers.get("content-type") || "";

        // If it's JSON, return it directly
        if (contentType.includes("application/json")) {
            const json = await response.json();
            const text = JSON.stringify(json, null, 2);
            return JSON.stringify({
                url,
                contentType: "json",
                content: text.slice(0, MAX_CONTENT_LENGTH),
                truncated: text.length > MAX_CONTENT_LENGTH,
            });
        }

        // For HTML/text, extract clean text
        const html = await response.text();
        const text = htmlToText(html);
        const truncated = text.length > MAX_CONTENT_LENGTH;

        return JSON.stringify({
            url,
            contentType: "text",
            content: text.slice(0, MAX_CONTENT_LENGTH),
            truncated,
            originalLength: text.length,
        });
    } catch (err) {
        const message =
            (err as Error).name === "AbortError"
                ? "Request timed out"
                : (err as Error).message || "Failed to fetch URL";
        return JSON.stringify({ error: message, url });
    }
}
