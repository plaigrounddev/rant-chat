/**
 * BrowserNavigator — High-level browser automation actions using Playwright.
 *
 * Connects to a Kernel browser instance via CDP and provides a clean API
 * for the agent to interact with web pages. Inspired by Manus AI's browser
 * capabilities: navigate, click, type, scroll, extract, screenshot.
 */

import { chromium, type Browser, type Page, type BrowserContext } from "playwright";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NavigateResult {
    url: string;
    title: string;
    status: number;
}

export interface ExtractedContent {
    text: string;
    html?: string;
}

export interface FormField {
    selector: string;
    value: string;
    type?: "text" | "select" | "checkbox" | "radio";
}

export interface InteractiveElement {
    tag: string;
    type?: string;
    text: string;
    selector: string;
    role?: string;
    name?: string;
    href?: string;
    placeholder?: string;
}

export interface PageSummary {
    url: string;
    title: string;
    description?: string;
    headings: string[];
    links: { text: string; href: string }[];
    forms: number;
    inputs: number;
    images: number;
}

// ---------------------------------------------------------------------------
// Navigator
// ---------------------------------------------------------------------------

export class BrowserNavigator {
    private browser: Browser | null = null;
    private context: BrowserContext | null = null;
    private page: Page | null = null;

    /**
     * Connect to a Kernel browser via its CDP WebSocket URL.
     */
    async connect(cdpWsUrl: string): Promise<void> {
        try {
            this.browser = await chromium.connectOverCDP(cdpWsUrl);

            // Get existing contexts or create a new one
            const contexts = this.browser.contexts();
            this.context = contexts.length > 0
                ? contexts[0]
                : await this.browser.newContext({
                    viewport: { width: 1280, height: 720 },
                });

            // Get existing pages or create a new one
            const pages = this.context.pages();
            this.page = pages.length > 0 ? pages[0] : await this.context.newPage();

            console.log("[BrowserNavigator] Connected to browser via CDP");
        } catch (error) {
            throw new Error(
                `Failed to connect to browser: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    /**
     * Disconnect from the browser without closing it.
     * The Kernel browser stays alive for reconnection.
     */
    async disconnect(): Promise<void> {
        if (this.browser) {
            // browser.close() on a CDP connection just disconnects, doesn't kill the browser
            await this.browser.close();
            this.browser = null;
            this.context = null;
            this.page = null;
            console.log("[BrowserNavigator] Disconnected from browser");
        }
    }

    private ensurePage(): Page {
        if (!this.page) {
            throw new Error("Not connected to a browser. Call connect() first.");
        }
        return this.page;
    }

    // -------------------------------------------------------------------------
    // Navigation
    // -------------------------------------------------------------------------

    /**
     * Navigate to a URL and wait for the page to load.
     */
    async navigate(url: string): Promise<NavigateResult> {
        const page = this.ensurePage();

        const response = await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: 30000,
        });

        return {
            url: page.url(),
            title: await page.title(),
            status: response?.status() ?? 0,
        };
    }

    /**
     * Go back in browser history.
     */
    async goBack(): Promise<NavigateResult> {
        const page = this.ensurePage();
        const response = await page.goBack({ waitUntil: "domcontentloaded" });
        return {
            url: page.url(),
            title: await page.title(),
            status: response?.status() ?? 0,
        };
    }

    /**
     * Go forward in browser history.
     */
    async goForward(): Promise<NavigateResult> {
        const page = this.ensurePage();
        const response = await page.goForward({ waitUntil: "domcontentloaded" });
        return {
            url: page.url(),
            title: await page.title(),
            status: response?.status() ?? 0,
        };
    }

    // -------------------------------------------------------------------------
    // Interaction
    // -------------------------------------------------------------------------

    /**
     * Click an element identified by CSS selector or XPath.
     */
    async click(selector: string): Promise<void> {
        const page = this.ensurePage();
        await page.click(selector, { timeout: 10000 });
    }

    /**
     * Type text into an input element.
     * @param selector - CSS selector for the input element
     * @param text - Text to type
     * @param clear - Whether to clear the field first (default: true)
     */
    async type(selector: string, text: string, clear = true): Promise<void> {
        const page = this.ensurePage();
        if (clear) {
            await page.fill(selector, text, { timeout: 10000 });
        } else {
            await page.type(selector, text, { timeout: 10000 });
        }
    }

    /**
     * Press a keyboard key (e.g., "Enter", "Tab", "Escape").
     */
    async pressKey(key: string): Promise<void> {
        const page = this.ensurePage();
        await page.keyboard.press(key);
    }

    /**
     * Scroll the page in a direction.
     */
    async scroll(
        direction: "up" | "down" | "left" | "right",
        amount = 500
    ): Promise<void> {
        const page = this.ensurePage();

        const scrollMap: Record<string, [number, number]> = {
            up: [0, -amount],
            down: [0, amount],
            left: [-amount, 0],
            right: [amount, 0],
        };

        const [x, y] = scrollMap[direction];
        await page.mouse.wheel(x, y);
        // Wait for any lazy-loaded content
        await page.waitForTimeout(500);
    }

    /**
     * Hover over an element.
     */
    async hover(selector: string): Promise<void> {
        const page = this.ensurePage();
        await page.hover(selector, { timeout: 10000 });
    }

    /**
     * Select an option from a <select> element.
     */
    async selectOption(selector: string, value: string): Promise<void> {
        const page = this.ensurePage();
        await page.selectOption(selector, value, { timeout: 10000 });
    }

    /**
     * Fill multiple form fields at once.
     */
    async fillForm(fields: FormField[]): Promise<void> {
        const page = this.ensurePage();
        const timeout = 10000;
        for (const field of fields) {
            switch (field.type) {
                case "select":
                    await page.selectOption(field.selector, field.value, { timeout });
                    break;
                case "radio":
                    // Radios are always checked (select the intended option)
                    await page.check(field.selector, { timeout });
                    break;
                case "checkbox":
                    if (field.value === "true" || field.value === "checked") {
                        await page.check(field.selector, { timeout });
                    } else {
                        await page.uncheck(field.selector, { timeout });
                    }
                    break;
                default:
                    await page.fill(field.selector, field.value, { timeout });
            }
        }
    }

    // -------------------------------------------------------------------------
    // Content Extraction
    // -------------------------------------------------------------------------

    /**
     * Extract text content from an element or the whole page.
     */
    async extractText(selector?: string): Promise<string> {
        const page = this.ensurePage();

        if (selector) {
            const element = page.locator(selector);
            return (await element.textContent()) ?? "";
        }

        // Get visible text content of the entire page body
        return page.evaluate(() => {
            const body = document.body;
            if (!body) return "";

            // Remove script/style elements from the clone
            const clone = body.cloneNode(true) as HTMLElement;
            clone.querySelectorAll("script, style, noscript").forEach((el) => el.remove());

            return clone.innerText || clone.textContent || "";
        });
    }

    /**
     * Extract all links from the current page.
     */
    async extractLinks(): Promise<{ text: string; href: string }[]> {
        const page = this.ensurePage();

        return page.evaluate(() => {
            const links = Array.from(document.querySelectorAll("a[href]"));
            return links
                .map((a) => ({
                    text: (a.textContent ?? "").trim(),
                    href: (a as HTMLAnchorElement).href,
                }))
                .filter((l) => l.text && l.href);
        });
    }

    /**
     * Extract structured content from the page: headings, paragraphs, lists, tables.
     */
    async extractStructuredContent(): Promise<ExtractedContent> {
        const page = this.ensurePage();

        const text = await page.evaluate(() => {
            const sections: string[] = [];

            // Extract headings
            document.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((h) => {
                const level = h.tagName.replace("H", "");
                sections.push(`${"#".repeat(Number(level))} ${(h.textContent ?? "").trim()}`);
            });

            // Extract paragraphs
            document.querySelectorAll("p").forEach((p) => {
                const text = (p.textContent ?? "").trim();
                if (text.length > 10) sections.push(text);
            });

            // Extract lists
            document.querySelectorAll("ul, ol").forEach((list) => {
                list.querySelectorAll("li").forEach((li) => {
                    sections.push(`• ${(li.textContent ?? "").trim()}`);
                });
            });

            return sections.join("\n\n");
        });

        return { text };
    }

    /**
     * Get a comprehensive summary of the current page.
     */
    async getPageSummary(): Promise<PageSummary> {
        const page = this.ensurePage();

        return page.evaluate(() => {
            const headings = Array.from(document.querySelectorAll("h1, h2, h3"))
                .map((h) => (h.textContent ?? "").trim())
                .filter(Boolean);

            const links = Array.from(document.querySelectorAll("a[href]"))
                .slice(0, 20) // Limit to first 20
                .map((a) => ({
                    text: (a.textContent ?? "").trim().slice(0, 100),
                    href: (a as HTMLAnchorElement).href,
                }))
                .filter((l) => l.text);

            const meta = document.querySelector('meta[name="description"]');

            return {
                url: window.location.href,
                title: document.title,
                description: meta?.getAttribute("content") ?? undefined,
                headings,
                links,
                forms: document.querySelectorAll("form").length,
                inputs: document.querySelectorAll("input, textarea, select").length,
                images: document.querySelectorAll("img").length,
            };
        });
    }

    /**
     * Find all interactive elements on the page (buttons, links, inputs, etc.).
     * Returns simplified descriptors the agent can use for targeting.
     */
    async findInteractiveElements(): Promise<InteractiveElement[]> {
        const page = this.ensurePage();

        return page.evaluate(() => {
            const selectors = [
                "a[href]",
                "button",
                'input:not([type="hidden"])',
                "textarea",
                "select",
                '[role="button"]',
                '[role="link"]',
                '[onclick]',
                '[tabindex]:not([tabindex="-1"])',
            ];

            const elements = Array.from(
                document.querySelectorAll(selectors.join(", "))
            );

            return elements
                .slice(0, 50) // limit to keep context manageable
                .map((el, index) => {
                    const htmlEl = el as HTMLElement;
                    const rect = htmlEl.getBoundingClientRect();

                    // Skip elements that are not visible
                    if (rect.width === 0 || rect.height === 0) return null;

                    // Generate a unique, stable selector
                    let selector = "";
                    if (htmlEl.id) {
                        selector = `#${htmlEl.id}`;
                    } else if (htmlEl.getAttribute("data-testid")) {
                        selector = `[data-testid="${htmlEl.getAttribute("data-testid")}"]`;
                    } else if (htmlEl.getAttribute("name")) {
                        selector = `${htmlEl.tagName.toLowerCase()}[name="${htmlEl.getAttribute("name")}"]`;
                    } else {
                        selector = `${htmlEl.tagName.toLowerCase()}:nth-of-type(${index + 1})`;
                    }

                    return {
                        tag: htmlEl.tagName.toLowerCase(),
                        type: htmlEl.getAttribute("type") ?? undefined,
                        text: (htmlEl.textContent ?? "").trim().slice(0, 100),
                        selector,
                        role: htmlEl.getAttribute("role") ?? undefined,
                        name: htmlEl.getAttribute("name") ?? htmlEl.getAttribute("aria-label") ?? undefined,
                        href: (htmlEl as HTMLAnchorElement).href ?? undefined,
                        placeholder: htmlEl.getAttribute("placeholder") ?? undefined,
                    };
                })
                .filter(Boolean) as InteractiveElement[];
        });
    }

    // -------------------------------------------------------------------------
    // Screenshots & Visual
    // -------------------------------------------------------------------------

    /**
     * Capture a screenshot of the current page.
     * @returns Base64-encoded PNG screenshot
     */
    async screenshot(options?: {
        fullPage?: boolean;
        selector?: string;
    }): Promise<string> {
        const page = this.ensurePage();

        let buffer: Buffer;

        if (options?.selector) {
            const element = page.locator(options.selector);
            buffer = await element.screenshot({ type: "png" });
        } else {
            buffer = await page.screenshot({
                type: "png",
                fullPage: options?.fullPage ?? false,
            });
        }

        return buffer.toString("base64");
    }

    // -------------------------------------------------------------------------
    // Wait & Timing
    // -------------------------------------------------------------------------

    /**
     * Wait for a selector to appear on the page.
     */
    async waitForSelector(
        selector: string,
        timeout = 10000
    ): Promise<boolean> {
        const page = this.ensurePage();
        try {
            await page.waitForSelector(selector, { timeout });
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Wait for navigation to complete (e.g., after clicking a link).
     */
    async waitForNavigation(timeout = 10000): Promise<void> {
        const page = this.ensurePage();
        await page.waitForLoadState("domcontentloaded", { timeout });
    }

    /**
     * Wait for a specific amount of time.
     */
    async wait(ms: number): Promise<void> {
        const page = this.ensurePage();
        await page.waitForTimeout(ms);
    }

    // -------------------------------------------------------------------------
    // JavaScript Execution
    // -------------------------------------------------------------------------

    /**
     * Execute arbitrary JavaScript in the page context.
     * @returns The result of the expression, serialized as a string.
     */
    async evaluateJS(expression: string): Promise<string> {
        const page = this.ensurePage();

        const result = await page.evaluate(expression);
        return result === undefined
            ? "undefined"
            : typeof result === "string"
                ? result
                : JSON.stringify(result, null, 2);
    }

    // -------------------------------------------------------------------------
    // Tab Management
    // -------------------------------------------------------------------------

    /**
     * Open a new tab and navigate to a URL.
     */
    async newTab(url?: string): Promise<void> {
        if (!this.context) throw new Error("Not connected to browser");
        this.page = await this.context.newPage();
        if (url) {
            await this.page.goto(url, { waitUntil: "domcontentloaded" });
        }
    }

    /**
     * Close the current tab and switch to the previous one.
     */
    async closeTab(): Promise<void> {
        if (!this.page || !this.context) return;
        await this.page.close();
        const pages = this.context.pages();
        this.page = pages.length > 0 ? pages[pages.length - 1] : null;
    }

    /**
     * Get current page URL and title.
     */
    async getCurrentInfo(): Promise<{ url: string; title: string }> {
        const page = this.ensurePage();
        return {
            url: page.url(),
            title: await page.title(),
        };
    }
}
