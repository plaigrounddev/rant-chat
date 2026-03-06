/**
 * HTTP Request Executor
 *
 * Mirrors Lindy AI's "HTTP Request" skill.
 * Allows the agent to make arbitrary HTTP requests to APIs.
 */

const MAX_RESPONSE_LENGTH = 8000;
const FETCH_TIMEOUT = 15000;

// Block requests to localhost / internal networks (SSRF protection)
const BLOCKED_HOSTS = [
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "::1",
    "169.254.",  // Link-local
    "10.",       // RFC1918 Class A
    "192.168.",  // RFC1918 Class C
    "100.64.",   // Carrier-grade NAT (RFC6598)
];

// IPv6 private/link-local prefixes
const BLOCKED_IPV6_PREFIXES = [
    "fc",  // fc00::/7 — Unique local addresses
    "fd",  // fc00::/7 — Unique local addresses
    "fe80", // fe80::/10 — Link-local
];

/**
 * Check if a hostname falls within the RFC1918 172.16.0.0–172.31.255.255 range.
 */
function isBlocked172(hostname: string): boolean {
    const m = hostname.match(/^172\.(\d+)\./);;
    if (!m) return false;
    const second = parseInt(m[1], 10);
    return second >= 16 && second <= 31;
}

export function isBlockedUrl(url: string): boolean {
    try {
        const parsed = new URL(url);
        const h = parsed.hostname.toLowerCase();

        // Check exact matches and prefix matches
        if (BLOCKED_HOSTS.some((b) => h === b || h.startsWith(b))) return true;

        // Check full RFC1918 172.16–31.x.x range
        if (isBlocked172(h)) return true;

        // Check IPv6 private/link-local prefixes
        if (BLOCKED_IPV6_PREFIXES.some((p) => h.startsWith(p))) return true;

        // Only allow http/https protocols
        if (!["http:", "https:"].includes(parsed.protocol)) return true;

        return false;
    } catch {
        return true;
    }
}

export interface HttpRequestArgs {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
}

export async function makeHttpRequest(args: HttpRequestArgs): Promise<string> {
    const { url, method = "GET", headers = {}, body } = args;

    // Validate URL
    try {
        new URL(url);
    } catch {
        return JSON.stringify({ error: "Invalid URL provided" });
    }

    // Security check
    if (isBlockedUrl(url)) {
        return JSON.stringify({
            error: "Requests to internal/localhost addresses are not allowed",
        });
    }

    const allowedMethods = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
    const upperMethod = method.toUpperCase();
    if (!allowedMethods.includes(upperMethod)) {
        return JSON.stringify({ error: `Unsupported HTTP method: ${method}` });
    }

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

        const fetchOptions: RequestInit = {
            method: upperMethod,
            signal: controller.signal,
            headers: {
                "User-Agent": "RantChat-Agent/1.0",
                ...headers,
            },
        };

        // Only include body for methods that support it
        if (body && ["POST", "PUT", "PATCH"].includes(upperMethod)) {
            fetchOptions.body = body;
            // Auto-set content-type if not provided (case-insensitive check per RFC 7230)
            const hasContentType = Object.keys(headers).some(
                (k) => k.toLowerCase() === "content-type"
            );
            if (!hasContentType) {
                (fetchOptions.headers as Record<string, string>)["Content-Type"] =
                    "application/json";
            }
        }

        const response = await fetch(url, fetchOptions);
        clearTimeout(timeout);

        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((value: string, key: string) => {
            responseHeaders[key] = value;
        });

        const contentType = response.headers.get("content-type") || "";
        let responseBody: string;

        // Read as text first — avoids consuming the body stream twice and
        // handles malformed JSON gracefully (server may claim application/json
        // but return invalid content).
        const rawText = await response.text();

        if (contentType.includes("application/json")) {
            try {
                responseBody = JSON.stringify(JSON.parse(rawText), null, 2);
            } catch {
                // Malformed JSON — return raw text for diagnostics
                responseBody = rawText;
            }
        } else {
            responseBody = rawText;
        }

        const truncated = responseBody.length > MAX_RESPONSE_LENGTH;

        return JSON.stringify({
            status: response.status,
            statusText: response.statusText,
            headers: responseHeaders,
            body: responseBody.slice(0, MAX_RESPONSE_LENGTH),
            truncated,
        });
    } catch (err) {
        const message =
            (err as Error).name === "AbortError"
                ? "Request timed out"
                : (err as Error).message || "HTTP request failed";
        return JSON.stringify({ error: message, url });
    }
}
