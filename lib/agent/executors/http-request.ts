/**
 * HTTP Request Executor
 *
 * Mirrors Lindy AI's "HTTP Request" skill.
 * Allows the agent to make arbitrary HTTP requests to APIs.
 */

const MAX_RESPONSE_LENGTH = 8000;
const FETCH_TIMEOUT = 15000;

// Block requests to localhost / internal networks
const BLOCKED_HOSTS = [
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "::1",
    "169.254.",
    "10.",
    "172.16.",
    "192.168.",
];

export function isBlockedUrl(url: string): boolean {
    try {
        const parsed = new URL(url);
        return BLOCKED_HOSTS.some(
            (h) => parsed.hostname === h || parsed.hostname.startsWith(h)
        );
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

        if (contentType.includes("application/json")) {
            const json = await response.json();
            responseBody = JSON.stringify(json, null, 2);
        } else {
            responseBody = await response.text();
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
