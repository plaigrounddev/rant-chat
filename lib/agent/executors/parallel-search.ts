/**
 * Parallel AI Search — Web search & URL extraction via Parallel API
 *
 * Two tools:
 * 1. parallelWebSearch() — Search the web for ranked results with excerpts
 * 2. parallelExtract()   — Extract content from specific URLs
 *
 * @see https://docs.parallel.ai/api-reference/search-beta/search
 * @see https://docs.parallel.ai/api-reference/extract-beta/extract
 */

const PARALLEL_API_KEY = process.env.PARALLEL_API_KEY;
const SEARCH_URL = "https://api.parallel.ai/v1beta/search";
const EXTRACT_URL = "https://api.parallel.ai/v1beta/extract";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SearchResult {
    url: string;
    title?: string | null;
    publish_date?: string | null;
    excerpts?: string[] | null;
}

interface SearchResponse {
    search_id: string;
    results: SearchResult[];
}

interface ExtractResult {
    url: string;
    title?: string | null;
    excerpts?: string[] | null;
    full_content?: string | null;
}

interface ExtractError {
    url: string;
    error_type: string;
    http_status_code?: number | null;
    content?: string | null;
}

interface ExtractResponse {
    extract_id: string;
    results: ExtractResult[];
    errors: ExtractError[];
}

// ---------------------------------------------------------------------------
// Web Search
// ---------------------------------------------------------------------------

export async function parallelWebSearch(
    query: string,
    mode: "fast" | "one-shot" | "agentic" = "fast",
    maxResults: number = 10
): Promise<string> {
    if (!PARALLEL_API_KEY) {
        return JSON.stringify({
            error: "PARALLEL_API_KEY not configured in .env.local",
            hint: "Get a key at https://platform.parallel.ai",
        });
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30_000);

    try {
        const response = await fetch(SEARCH_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": PARALLEL_API_KEY,
            },
            body: JSON.stringify({
                objective: query,
                search_queries: [query],
                mode,
                max_results: maxResults,
                excerpts: {
                    max_chars_per_result: 5000,
                },
            }),
            signal: controller.signal,
        });

        if (!response.ok) {
            const errorText = await response.text();
            return JSON.stringify({
                error: `Parallel Search API error: ${response.status}`,
                details: errorText.slice(0, 500),
            });
        }

        const data: SearchResponse = await response.json();

        // Format results for the agent
        const results = data.results.map((r) => ({
            url: r.url,
            title: r.title ?? "",
            date: r.publish_date ?? "",
            content: (r.excerpts ?? []).join("\n\n"),
        }));

        return JSON.stringify({
            success: true,
            search_id: data.search_id,
            query,
            mode,
            results_count: results.length,
            results,
        });
    } catch (err) {
        return JSON.stringify({
            error: `Search failed: ${(err as Error).message}`,
            query,
        });
    } finally {
        clearTimeout(timeoutId);
    }
}

// ---------------------------------------------------------------------------
// URL Extraction
// ---------------------------------------------------------------------------

export async function parallelExtract(
    urls: string[],
    objective?: string
): Promise<string> {
    if (!PARALLEL_API_KEY) {
        return JSON.stringify({
            error: "PARALLEL_API_KEY not configured in .env.local",
            hint: "Get a key at https://platform.parallel.ai",
        });
    }

    if (!urls.length) {
        return JSON.stringify({ error: "At least one URL is required" });
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30_000);

    try {
        const response = await fetch(EXTRACT_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": PARALLEL_API_KEY,
            },
            body: JSON.stringify({
                urls,
                ...(objective && { objective }),
                excerpts: true,
                full_content: false,
            }),
            signal: controller.signal,
        });

        if (!response.ok) {
            const errorText = await response.text();
            return JSON.stringify({
                error: `Parallel Extract API error: ${response.status}`,
                details: errorText.slice(0, 500),
            });
        }

        const data: ExtractResponse = await response.json();

        const results = data.results.map((r) => ({
            url: r.url,
            title: r.title ?? "",
            content: (r.excerpts ?? []).join("\n\n"),
        }));

        const errors = data.errors.map((e) => ({
            url: e.url,
            error: e.error_type,
            status: e.http_status_code,
        }));

        return JSON.stringify({
            success: true,
            extract_id: data.extract_id,
            results_count: results.length,
            results,
            ...(errors.length && { errors }),
        });
    } catch (err) {
        return JSON.stringify({
            error: `Extract failed: ${(err as Error).message}`,
            urls,
        });
    } finally {
        clearTimeout(timeoutId);
    }
}
