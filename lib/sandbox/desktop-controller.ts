/**
 * DesktopController — Computer Use via E2B Desktop SDK.
 *
 * Provides a full Ubuntu 22.04 desktop (XFCE) with mouse, keyboard, and
 * screenshot capabilities. The agent can see the desktop via screenshots
 * and interact with any GUI application.
 *
 * Agent loop pattern (from E2B docs):
 * 1. Take screenshot
 * 2. Send to LLM for analysis
 * 3. Execute action (click, type, scroll, etc.)
 * 4. Repeat until task complete
 */

import { Sandbox as DesktopSandbox } from "@e2b/desktop";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DesktopCreateOptions {
    /** Screen resolution [width, height] (default: [1024, 768]) */
    resolution?: [number, number];
    /** DPI setting (default: 96) */
    dpi?: number;
    /** Timeout in milliseconds (default: 10 minutes) */
    timeoutMs?: number;
}

export interface DesktopAction {
    type: "click" | "double_click" | "right_click" | "type" | "press" | "scroll" | "drag" | "move";
    x?: number;
    y?: number;
    text?: string;
    key?: string;
    direction?: "up" | "down";
    ticks?: number;
    startX?: number;
    startY?: number;
    endX?: number;
    endY?: number;
}

export interface DesktopState {
    /** Base64-encoded PNG screenshot */
    screenshot: string;
    /** Live view stream URL (if streaming is started) */
    streamUrl?: string;
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

export class DesktopController {
    private sandbox: DesktopSandbox | null = null;
    private streamUrl: string | null = null;

    /**
     * Create a new desktop sandbox.
     */
    async createDesktop(
        options: DesktopCreateOptions = {}
    ): Promise<void> {
        const {
            resolution = [1024, 768],
            dpi = 96,
            timeoutMs = 10 * 60 * 1000,
        } = options;

        // Tear down existing sandbox to prevent orphaned VMs
        if (this.sandbox) {
            try {
                await this.sandbox.kill();
            } catch (error: unknown) {
                console.warn("[DesktopController] Failed to tear down previous sandbox:", error);
            }
            this.sandbox = null;
            this.streamUrl = null;
        }

        this.sandbox = await DesktopSandbox.create({
            resolution,
            dpi,
            timeoutMs,
        });

        console.log("[DesktopController] Desktop sandbox created");
    }

    /**
     * Start live view streaming and return the URL.
     */
    async startStream(): Promise<string> {
        this.ensureSandbox();
        await this.sandbox!.stream.start();
        this.streamUrl = this.sandbox!.stream.getUrl();
        console.log("[DesktopController] Stream started:", this.streamUrl);
        return this.streamUrl;
    }

    /**
     * Capture a screenshot of the current desktop state.
     * @returns Base64-encoded PNG image
     */
    async screenshot(): Promise<string> {
        this.ensureSandbox();
        const buffer = await this.sandbox!.screenshot();
        return Buffer.from(buffer).toString("base64");
    }

    /**
     * Get the current desktop state (screenshot + stream URL).
     */
    async getState(): Promise<DesktopState> {
        return {
            screenshot: await this.screenshot(),
            streamUrl: this.streamUrl ?? undefined,
        };
    }

    // -------------------------------------------------------------------------
    // Mouse Actions
    // -------------------------------------------------------------------------

    async leftClick(x: number, y: number): Promise<void> {
        this.ensureSandbox();
        await this.sandbox!.leftClick(x, y);
    }

    async rightClick(x: number, y: number): Promise<void> {
        this.ensureSandbox();
        await this.sandbox!.rightClick(x, y);
    }

    async doubleClick(x: number, y: number): Promise<void> {
        this.ensureSandbox();
        await this.sandbox!.doubleClick(x, y);
    }

    async middleClick(x: number, y: number): Promise<void> {
        this.ensureSandbox();
        await this.sandbox!.middleClick(x, y);
    }

    async moveMouse(x: number, y: number): Promise<void> {
        this.ensureSandbox();
        await this.sandbox!.moveMouse(x, y);
    }

    async drag(
        from: [number, number],
        to: [number, number]
    ): Promise<void> {
        this.ensureSandbox();
        await this.sandbox!.drag(from, to);
    }

    // -------------------------------------------------------------------------
    // Keyboard Actions
    // -------------------------------------------------------------------------

    async type(text: string): Promise<void> {
        this.ensureSandbox();
        await this.sandbox!.write(text);
    }

    async press(key: string): Promise<void> {
        this.ensureSandbox();
        await this.sandbox!.press(key);
    }

    // -------------------------------------------------------------------------
    // Scrolling
    // -------------------------------------------------------------------------

    async scroll(
        direction: "up" | "down",
        ticks = 3
    ): Promise<void> {
        this.ensureSandbox();
        await this.sandbox!.scroll(direction, ticks);
    }

    // -------------------------------------------------------------------------
    // Shell Commands (within desktop sandbox)
    // -------------------------------------------------------------------------

    async runCommand(command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
        this.ensureSandbox();
        const result = await this.sandbox!.commands.run(command);
        return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
    }

    // -------------------------------------------------------------------------
    // Composite Actions
    // -------------------------------------------------------------------------

    /**
     * Execute a desktop action from a structured description.
     * Used by the agent loop to dispatch LLM-decided actions.
     */
    async executeAction(action: DesktopAction): Promise<void> {
        switch (action.type) {
            case "click":
                if (action.x == null || action.y == null) throw new Error("click requires x and y coordinates");
                await this.leftClick(action.x, action.y);
                break;
            case "double_click":
                if (action.x == null || action.y == null) throw new Error("double_click requires x and y coordinates");
                await this.doubleClick(action.x, action.y);
                break;
            case "right_click":
                if (action.x == null || action.y == null) throw new Error("right_click requires x and y coordinates");
                await this.rightClick(action.x, action.y);
                break;
            case "type":
                if (!action.text) throw new Error("type requires text");
                await this.type(action.text);
                break;
            case "press":
                if (!action.key) throw new Error("press requires key");
                await this.press(action.key);
                break;
            case "scroll":
                await this.scroll(action.direction ?? "down", action.ticks ?? 3);
                break;
            case "drag":
                if (action.startX == null || action.startY == null || action.endX == null || action.endY == null)
                    throw new Error("drag requires startX, startY, endX, endY");
                await this.drag(
                    [action.startX, action.startY],
                    [action.endX, action.endY]
                );
                break;
            case "move":
                if (action.x == null || action.y == null) throw new Error("move requires x and y coordinates");
                await this.moveMouse(action.x, action.y);
                break;
        }
    }

    // -------------------------------------------------------------------------
    // Lifecycle
    // -------------------------------------------------------------------------

    /**
     * Kill the desktop sandbox.
     */
    async kill(): Promise<void> {
        if (this.sandbox) {
            await this.sandbox.kill();
            this.sandbox = null;
            this.streamUrl = null;
            console.log("[DesktopController] Desktop sandbox terminated");
        }
    }

    /**
     * Check if a desktop sandbox is active.
     */
    isActive(): boolean {
        return this.sandbox !== null;
    }

    private ensureSandbox(): void {
        if (!this.sandbox) {
            throw new Error(
                "No desktop sandbox active. Call createDesktop() first."
            );
        }
    }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _instance: DesktopController | null = null;

export function getDesktopController(): DesktopController {
    if (!_instance) {
        _instance = new DesktopController();
    }
    return _instance;
}
