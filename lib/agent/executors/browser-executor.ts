/**
 * Browser Executor — Dispatches browser tool calls to the Kernel browser system.
 *
 * This executor bridges the agent's tool-calling interface with the
 * KernelBrowserManager and BrowserNavigator modules. When the agent invokes
 * a browser_* tool, this executor handles:
 * 1. Creating/reusing a Kernel browser instance (scoped per session)
 * 2. Connecting Playwright via CDP
 * 3. Executing the requested browser action
 * 4. Formatting results for the agent
 *
 * IMPORTANT: Each agent session (task run) gets its own isolated browser
 * to prevent cross-session data leakage (cookies, auth, page state).
 */

import {
    getKernelBrowserManager,
    BrowserNavigator,
    isBrowserTool,
} from "../../browser";

// ---------------------------------------------------------------------------
// Per-session browser state (isolated per task run)
// ---------------------------------------------------------------------------

interface BrowserSession {
    navigator: BrowserNavigator;
    browserId: string;
}

/** Map of sessionId → browser state. Each task run gets its own browser. */
const sessions: Map<string, BrowserSession> = new Map();

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

/**
 * Execute a browser tool call, scoped to a session.
 *
 * @param toolName - The browser tool name (e.g., "browser_navigate")
 * @param args - The parsed tool arguments
 * @param sessionId - Unique session/task ID for isolation (required)
 * @returns A string result for the agent
 */
export async function executeBrowserTool(
    toolName: string,
    args: Record<string, unknown>,
    sessionId?: string
): Promise<string> {
    if (!isBrowserTool(toolName)) {
        return JSON.stringify({ error: `Unknown browser tool: ${toolName}` });
    }

    // Use a default session if none provided (single-user fallback)
    const sid = sessionId || "__default__";

    try {
        // Ensure we have an active browser for this session
        const session = await ensureBrowserConnection(sid);

        // Dispatch to the correct handler
        switch (toolName) {
            case "browser_navigate": {
                const result = await session.navigator.navigate(args.url as string);
                return JSON.stringify({
                    success: true,
                    url: result.url,
                    title: result.title,
                    status: result.status,
                });
            }

            case "browser_click": {
                await session.navigator.click(args.selector as string);
                return JSON.stringify({ success: true, action: "clicked", selector: args.selector });
            }

            case "browser_type": {
                await session.navigator.type(
                    args.selector as string,
                    args.text as string,
                    args.clearFirst as boolean ?? true
                );
                return JSON.stringify({ success: true, action: "typed", selector: args.selector });
            }

            case "browser_scroll": {
                await session.navigator.scroll(
                    args.direction as "up" | "down" | "left" | "right",
                    (args.amount as number) ?? 500
                );
                return JSON.stringify({ success: true, action: "scrolled", direction: args.direction });
            }

            case "browser_extract_text": {
                const text = await session.navigator.extractText(args.selector as string | undefined);
                return JSON.stringify({
                    success: true,
                    text: text.slice(0, 10000), // Limit text to avoid huge context
                });
            }

            case "browser_screenshot": {
                const screenshot = await session.navigator.screenshot({
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
                await session.navigator.fillForm(fields);
                return JSON.stringify({
                    success: true,
                    action: "form_filled",
                    fieldsCount: fields.length,
                });
            }

            case "browser_evaluate_js": {
                const result = await session.navigator.evaluateJS(args.expression as string);
                return JSON.stringify({ success: true, result });
            }

            case "browser_wait": {
                if (args.ms) {
                    await session.navigator.wait(args.ms as number);
                    return JSON.stringify({ success: true, action: "waited", ms: args.ms });
                }
                if (args.selector) {
                    const found = await session.navigator.waitForSelector(
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
                const links = await session.navigator.extractLinks();
                return JSON.stringify({
                    success: true,
                    links: links.slice(0, 50), // Limit to 50 links
                    total: links.length,
                });
            }

            case "browser_get_page_summary": {
                const summary = await session.navigator.getPageSummary();
                return JSON.stringify({ success: true, ...summary });
            }

            case "browser_find_elements": {
                const elements = await session.navigator.findInteractiveElements();
                return JSON.stringify({
                    success: true,
                    elements,
                    total: elements.length,
                });
            }

            case "browser_press_key": {
                await session.navigator.pressKey(args.key as string);
                return JSON.stringify({ success: true, action: "key_pressed", key: args.key });
            }

            case "browser_new_tab": {
                await session.navigator.newTab(args.url as string | undefined);
                return JSON.stringify({ success: true, action: "new_tab_opened", url: args.url });
            }

            case "browser_close_tab": {
                await session.navigator.closeTab();
                return JSON.stringify({ success: true, action: "tab_closed" });
            }

            case "browser_go_back": {
                const result = await session.navigator.goBack();
                return JSON.stringify({ success: true, ...result });
            }

            case "browser_close": {
                await closeBrowserSession(sid);
                return JSON.stringify({ success: true, action: "browser_closed" });
            }

            default:
                return JSON.stringify({ error: `Unhandled browser tool: ${toolName}` });
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[BrowserExecutor] Error executing ${toolName} (session=${sid}):`, message);
        return JSON.stringify({
            success: false,
            error: message,
            tool: toolName,
        });
    }
}

// ---------------------------------------------------------------------------
// Connection Management (per-session)
// ---------------------------------------------------------------------------

async function ensureBrowserConnection(sessionId: string): Promise<BrowserSession> {
    const existing = sessions.get(sessionId);
    if (existing) return existing;

    const manager = getKernelBrowserManager();
    const instance = await manager.getOrCreateBrowser();

    const nav = new BrowserNavigator();
    await nav.connect(instance.cdpWsUrl);

    const session: BrowserSession = {
        navigator: nav,
        browserId: instance.id,
    };

    sessions.set(sessionId, session);
    console.log(`[BrowserExecutor] New browser session: ${sessionId} → browser ${instance.id}`);
    return session;
}

async function closeBrowserSession(sessionId: string): Promise<void> {
    const session = sessions.get(sessionId);
    if (!session) return;

    await session.navigator.disconnect();
    const manager = getKernelBrowserManager();
    await manager.closeBrowser(session.browserId);
    sessions.delete(sessionId);
    console.log(`[BrowserExecutor] Closed browser session: ${sessionId}`);
}

/**
 * Clean up a specific session's browser resources.
 * Call this when a task run completes.
 */
export async function cleanupBrowserSession(sessionId: string): Promise<void> {
    await closeBrowserSession(sessionId);
}

/**
 * Clean up ALL browser resources. Call during shutdown.
 */
export async function cleanupBrowserExecutor(): Promise<void> {
    const sids = Array.from(sessions.keys());
    for (const sid of sids) {
        await closeBrowserSession(sid);
    }
    const manager = getKernelBrowserManager();
    await manager.closeAll();
}
