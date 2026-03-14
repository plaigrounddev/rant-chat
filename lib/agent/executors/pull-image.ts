import { registerSkill } from "../skills";

registerSkill({
    name: "pull_image",
    description: "Fetches an image from a URL and returns it as base64. Use this when you want to display an image to the user. Do not use markdown `![alt](url)` for images, use this tool instead.",
    category: "utilities",
    toolDefinition: {
        type: "function",
        name: "pull_image",
        description: "Fetches an image from a URL and returns it as base64. Use this when you want to display an image to the user instead of markdown.",
        parameters: {
            type: "object",
            properties: {
                url: {
                    type: "string",
                    description: "The URL of the image to fetch",
                },
                alt: {
                    type: "string",
                    description: "A short description of the image for accessibility",
                }
            },
            required: ["url"],
        },
    },
    executor: async (args) => {
        const url = typeof args.url === "string" ? args.url : undefined;
        if (!url) {
            return JSON.stringify({ error: "url is required" });
        }

        try {
            const response = await fetch(url, {
                headers: {
                    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
                    "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
                    "Accept-Language": "en-US,en;q=0.9",
                    "Referer": new URL(url).origin + "/",
                },
                redirect: "follow",
                signal: AbortSignal.timeout(15_000),
            });

            if (!response.ok) {
                return JSON.stringify({ error: `Failed to fetch image: ${response.status} ${response.statusText}` });
            }

            const contentType = response.headers.get("content-type")?.split(";")[0].trim() || "image/png";

            if (!contentType.startsWith("image/")) {
                return JSON.stringify({ error: "URL did not return an image" });
            }

            const buffer = await response.arrayBuffer();
            const base64 = Buffer.from(buffer).toString("base64");

            return JSON.stringify({
                base64,
                mediaType: contentType,
                alt: typeof args.alt === "string" ? args.alt : undefined
            });
        } catch (error) {
            return JSON.stringify({ error: (error as Error).message });
        }
    },
});
