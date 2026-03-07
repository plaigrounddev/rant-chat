/**
 * Browser Executor — Dispatches browser tool calls to the Kernel browser system.
 *
 * This executor bridges the agent's tool-calling interface with the
 * KernelBrowserManager and BrowserNavigator modules. When the agent invokes
 * a browser_* tool, this executor handles:
 * 1. Creating/reusing a Kernel browser instance
 * 2. Connecting Playwright via CDP
 * 3. Executing the requested browser action
 * 4. Formatting results for the agent
 */

import {
    getKernelBrowserManager,
    BrowserNavigator,
    isBrowserTool,
} from "../../browser";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let navigator: BrowserNavigator | null = null;
let currentBrowserId: string | null = null;

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

/**
 * Execute a browser tool call.
 *
 * @param toolName - The browser tool name (e.g., "browser_navigate")
 * @param args - The parsed tool arguments
 * @returns A string result for the agent
 */
export async function executeBrowserTool(
    toolName: string,
    args: Record<string, unknown>
): Promise<string> {
    if (!isBrowserTool(toolName)) {
        return JSON.stringify({ error: `Unknown browser tool: ${toolName}` });
    }

    try {
        // Ensure we have an active browser + navigator
        await ensureBrowserConnection();

        if (!navigator) {
            return JSON.stringify({ error: "Failed to establish browser connection" });
        }

        // Dispatch to the correct handler
        switch (toolName) {
            case "browser_navigate": {
                const result = await navigator.navigate(args.url as string);
                return JSON.stringify({
                    success: true,
                    url: result.url,
                    title: result.title,
                    status: result.status,
                });
            }

            case "browser_click": {
                await navigator.click(args.selector as string);
                return JSON.stringify({ success: true, action: "clicked", selector: args.selector });
            }

            case "browser_type": {
                await navigator.type(
                    args.selector as string,
                    args.text as string,
                    args.clearFirst as boolean ?? true
                );
                return JSON.stringify({ success: true, action: "typed", selector: args.selector });
            }

            case "browser_scroll": {
                await navigator.scroll(
                    args.direction as "up" | "down" | "left" | "right",
                    (args.amount as number) ?? 500
                );
                return JSON.stringify({ success: true, action: "scrolled", direction: args.direction });
            }

            case "browser_extract_text": {
                const text = await navigator.extractText(args.selector as string | undefined);
                return JSON.stringify({
                    success: true,
                    text: text.slice(0, 10000), // Limit text to avoid huge context
                });
            }

            case "browser_screenshot": {
                const screenshot = await navigator.screenshot({
                    fullPage: args.fullPage as boolean,
                    selector: args.selector as string | undefined,
                });
                return JSON.stringify({
                    success: true,
                    screenshot: screenshot.slice(0, 100) + "...", // Truncate for text response
                    screenshotBase64: screenshot, // Full image data
                    format: "png",
                });
            }

            case "browser_fill_form": {
                const fields = args.fields as Array<{
                    selector: string;
                    value: string;
                    type?: "text" | "select" | "checkbox" | "radio";
                }>;
                await navigator.fillForm(fields);
                return JSON.stringify({
                    success: true,
                    action: "form_filled",
                    fieldsCount: fields.length,
                });
            }

            case "browser_evaluate_js": {
                const result = await navigator.evaluateJS(args.expression as string);
                return JSON.stringify({ success: true, result });
            }

            case "browser_wait": {
                if (args.ms) {
                    await navigator.wait(args.ms as number);
                    return JSON.stringify({ success: true, action: "waited", ms: args.ms });
                }
                if (args.selector) {
                    const found = await navigator.waitForSelector(
                        args.selector as string,
                        (args.timeout as number) ?? 10000
                    );
                    return JSON.stringify({
                        success: true,
                        action: "waited_for_selector",
                        found,
                        selector: args.selector,
                    });
                }
                return JSON.stringify({ error: "Must specify either selector or ms" });
            }

            case "browser_get_links": {
                const links = await navigator.extractLinks();
                return JSON.stringify({
                    success: true,
                    links: links.slice(0, 50), // Limit to 50 links
                    total: links.length,
                });
            }

            case "browser_get_page_summary": {
                const summary = await navigator.getPageSummary();
                return JSON.stringify({ success: true, ...summary });
            }

            case "browser_find_elements": {
                const elements = await navigator.findInteractiveElements();
                return JSON.stringify({
                    success: true,
                    elements,
                    total: elements.length,
                });
            }

            case "browser_press_key": {
                await navigator.pressKey(args.key as string);
                return JSON.stringify({ success: true, action: "key_pressed", key: args.key });
            }

            case "browser_new_tab": {
                await navigator.newTab(args.url as string | undefined);
                return JSON.stringify({ success: true, action: "new_tab_opened", url: args.url });
            }

            case "browser_close_tab": {
                await navigator.closeTab();
                return JSON.stringify({ success: true, action: "tab_closed" });
            }

            case "browser_go_back": {
                const result = await navigator.goBack();
                return JSON.stringify({ success: true, ...result });
            }

            case "browser_close": {
                await closeBrowser();
                return JSON.stringify({ success: true, action: "browser_closed" });
            }

            default:
                return JSON.stringify({ error: `Unhandled browser tool: ${toolName}` });
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[BrowserExecutor] Error executing ${toolName}:`, message);
        return JSON.stringify({
            success: false,
            error: message,
            tool: toolName,
        });
    }
}

// ---------------------------------------------------------------------------
// Connection Management
// ---------------------------------------------------------------------------

async function ensureBrowserConnection(): Promise<void> {
    if (navigator) return; // Already connected

    const manager = getKernelBrowserManager();
    const instance = await manager.getOrCreateBrowser();

    navigator = new BrowserNavigator();
    await navigator.connect(instance.cdpWsUrl);
    currentBrowserId = instance.id;
}

async function closeBrowser(): Promise<void> {
    if (navigator) {
        await navigator.disconnect();
        navigator = null;
    }
    if (currentBrowserId) {
        const manager = getKernelBrowserManager();
        await manager.closeBrowser(currentBrowserId);
        currentBrowserId = null;
    }
}

/**
 * Clean up all browser resources. Call during shutdown.
 */
export async function cleanupBrowserExecutor(): Promise<void> {
    await closeBrowser();
    const manager = getKernelBrowserManager();
    await manager.closeAll();
}
