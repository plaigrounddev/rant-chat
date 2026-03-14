/**
 * Perplexity Search — Web search via Perplexity Sonar model (OpenRouter)
 *
 * Calls OpenRouter's API with the perplexity/sonar model to get
 * grounded, cited web search results.
 */

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "perplexity/sonar";

export async function perplexitySearch(query: string): Promise<string> {
    if (!OPENROUTER_API_KEY) {
        return JSON.stringify({
            error: "OPENROUTER_API_KEY not configured in .env.local",
            hint: "Get a key at https://openrouter.ai/keys",
        });
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30_000);

    try {
        const response = await fetch(OPENROUTER_URL, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${OPENROUTER_API_KEY}`,
                "Content-Type": "application/json",
                "HTTP-Referer": "https://rantchat.dev",
                "X-Title": "RantChat Agent",
            },
            body: JSON.stringify({
                model: MODEL,
                messages: [
                    {
                        role: "user",
                        content: query,
                    },
                ],
            }),
            signal: controller.signal,
        });

        if (!response.ok) {
            const errorText = await response.text();
            return JSON.stringify({
                error: `OpenRouter API error: ${response.status}`,
                details: errorText.slice(0, 500),
            });
        }

        const data = await response.json();
        const answer = data.choices?.[0]?.message?.content || "No results found.";
        // OpenRouter returns citations in annotations, not at data.citations
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const annotations = data.choices?.[0]?.message?.annotations || [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const citations = annotations
            .filter((a: any) => a.type === "url_citation")
            .map((a: any) => a.url_citation?.url)
            .filter(Boolean);

        return JSON.stringify({
            answer,
            citations,
            model: MODEL,
            query,
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
