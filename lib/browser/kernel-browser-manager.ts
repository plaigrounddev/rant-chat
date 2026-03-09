/**
 * KernelBrowserManager — Manages browser instance lifecycle using the Kernel SDK.
 *
 * Kernel provides sandboxed, cloud-hosted Chrome browsers that our agent
 * connects to via Chrome DevTools Protocol (CDP). Each browser instance is
 * isolated in its own VM with full Chrome capabilities.
 */

import Kernel from "@onkernel/sdk";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BrowserCreateOptions {
    profileId?: string;
    timeoutMs?: number;
    enableLiveView?: boolean;
    enableRecording?: boolean;
    viewportWidth?: number;
    viewportHeight?: number;
}

export interface BrowserInstance {
    id: string;
    cdpWsUrl: string;
    liveViewUrl?: string;
    createdAt: Date;
    expiresAt: Date;
    status: "creating" | "running" | "paused" | "terminated";
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const MAX_TIMEOUT_MS = 72 * 60 * 60 * 1000; // 72 hours

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

export class KernelBrowserManager {
    private kernel: InstanceType<typeof Kernel>;
    private activeBrowsers: Map<string, BrowserInstance> = new Map();

    constructor() {
        this.kernel = new Kernel();
    }

    async createBrowser(options: BrowserCreateOptions = {}): Promise<BrowserInstance> {
        const timeoutMs = Math.min(
            options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
            MAX_TIMEOUT_MS
        );

        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const createParams: any = {};
            if (options.profileId) {
                createParams.profile = { id: options.profileId };
            }

            const kernelBrowser = await this.kernel.browsers.create(createParams);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const raw = kernelBrowser as any;
            const browserId: string = raw.id ?? crypto.randomUUID();

            const instance: BrowserInstance = {
                id: browserId,
                cdpWsUrl: kernelBrowser.cdp_ws_url,
                liveViewUrl: raw.live_view_url ?? undefined,
                createdAt: new Date(),
                expiresAt: new Date(Date.now() + timeoutMs),
                status: "running",
            };

            this.activeBrowsers.set(instance.id, instance);

            console.log(
                `[KernelBrowserManager] Browser created: ${instance.id} (CDP: ${instance.cdpWsUrl})`
            );

            return instance;
        } catch (error: unknown) {
            console.error("[KernelBrowserManager] Failed to create browser:", error);
            throw new Error(
                `Failed to create browser: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    getBrowser(id: string): BrowserInstance | undefined {
        return this.activeBrowsers.get(id);
    }

    async closeBrowser(id: string): Promise<void> {
        const instance = this.activeBrowsers.get(id);
        if (!instance) {
            console.warn(`[KernelBrowserManager] Browser ${id} not found`);
            return;
        }

        try {
            // Terminate the remote Kernel browser to prevent cloud resource leaks
            await this.kernel.browsers.deleteByID(id);
            instance.status = "terminated";
            this.activeBrowsers.delete(id);
            console.log(`[KernelBrowserManager] Browser ${id} terminated (remote + local)`);
        } catch (error: unknown) {
            console.error(`[KernelBrowserManager] Failed to close browser ${id}:`, error);
            // Still clean up local state even if remote call fails
            instance.status = "terminated";
            this.activeBrowsers.delete(id);
        }
    }

    listBrowsers(): BrowserInstance[] {
        const now = new Date();
        for (const [id, browser] of this.activeBrowsers) {
            if (browser.expiresAt < now) {
                browser.status = "terminated";
                this.activeBrowsers.delete(id);
            }
        }
        return Array.from(this.activeBrowsers.values());
    }

    async getOrCreateBrowser(options: BrowserCreateOptions = {}): Promise<BrowserInstance> {
        const existing = Array.from(this.activeBrowsers.values()).find(
            (b) => b.status === "running" && b.expiresAt > new Date()
        );

        if (existing) {
            console.log(`[KernelBrowserManager] Reusing existing browser: ${existing.id}`);
            return existing;
        }

        return this.createBrowser(options);
    }

    async closeAll(): Promise<void> {
        const ids = Array.from(this.activeBrowsers.keys());
        await Promise.all(ids.map((id) => this.closeBrowser(id)));
        console.log(`[KernelBrowserManager] All ${ids.length} browsers closed`);
    }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _instance: KernelBrowserManager | null = null;

export function getKernelBrowserManager(): KernelBrowserManager {
    if (!_instance) {
        _instance = new KernelBrowserManager();
    }
    return _instance;
}
