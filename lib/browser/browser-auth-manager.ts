/**
 * BrowserAuthManager — Manages authentication state and session persistence.
 *
 * Uses Kernel's managed auth profiles to persist browser sessions (cookies,
 * localStorage) across runs. Sessions can last up to 72 hours.
 *
 * Auth profiles are persisted to disk (.rantchat/auth-profiles.json) so
 * sessions survive process restarts.
 *
 * Future integration point for LastPass / 1Password / credential managers.
 */

import type { BrowserContext } from "playwright";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionData {
    cookies: CookieData[];
    localStorage: Record<string, string>;
    savedAt: string;
}

export interface CookieData {
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite: "Strict" | "Lax" | "None";
}

export interface AuthProfile {
    id: string;
    name: string;
    domain: string;
    sessionData?: SessionData;
    createdAt: string;
    updatedAt: string;
}

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

const DATA_DIR = path.join(process.cwd(), ".rantchat");
const PROFILES_FILE = path.join(DATA_DIR, "auth-profiles.json");

function loadProfilesFromDisk(): Map<string, AuthProfile> {
    try {
        if (fs.existsSync(PROFILES_FILE)) {
            const raw = fs.readFileSync(PROFILES_FILE, "utf-8");
            const entries: [string, AuthProfile][] = JSON.parse(raw);
            return new Map(entries);
        }
    } catch (error) {
        console.warn("[BrowserAuthManager] Failed to load profiles from disk:", error);
    }
    return new Map();
}

function saveProfilesToDisk(profiles: Map<string, AuthProfile>): void {
    try {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        const entries = Array.from(profiles.entries());
        fs.writeFileSync(PROFILES_FILE, JSON.stringify(entries, null, 2), "utf-8");
    } catch (error) {
        console.warn("[BrowserAuthManager] Failed to save profiles to disk:", error);
    }
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

export class BrowserAuthManager {
    private profiles: Map<string, AuthProfile>;

    constructor() {
        this.profiles = loadProfilesFromDisk();
    }

    /**
     * Save the current browser session (cookies + localStorage) for a profile.
     */
    async saveSession(
        profileId: string,
        context: BrowserContext,
        domain: string
    ): Promise<void> {
        const cookies = await context.cookies();
        const pages = context.pages();
        const page = pages.length > 0 ? pages[0] : null;

        let localStorage: Record<string, string> = {};
        if (page) {
            try {
                localStorage = await page.evaluate(() => {
                    const data: Record<string, string> = {};
                    for (let i = 0; i < window.localStorage.length; i++) {
                        const key = window.localStorage.key(i);
                        if (key) {
                            data[key] = window.localStorage.getItem(key) ?? "";
                        }
                    }
                    return data;
                });
            } catch {
                // Page might not allow localStorage access on some domains
                console.warn(
                    `[BrowserAuthManager] Could not save localStorage for ${domain}`
                );
            }
        }

        const sessionData: SessionData = {
            cookies: cookies.map((c) => ({
                name: c.name,
                value: c.value,
                domain: c.domain,
                path: c.path,
                expires: c.expires,
                httpOnly: c.httpOnly,
                secure: c.secure,
                sameSite: c.sameSite as "Strict" | "Lax" | "None",
            })),
            localStorage,
            savedAt: new Date().toISOString(),
        };

        const profile: AuthProfile = this.profiles.get(profileId) ?? {
            id: profileId,
            name: profileId,
            domain,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        profile.sessionData = sessionData;
        profile.updatedAt = new Date().toISOString();
        this.profiles.set(profileId, profile);
        saveProfilesToDisk(this.profiles);

        console.log(
            `[BrowserAuthManager] Session saved for profile ${profileId} (${cookies.length} cookies)`
        );
    }

    /**
     * Restore a saved session into a browser context.
     */
    async restoreSession(
        profileId: string,
        context: BrowserContext
    ): Promise<boolean> {
        const profile = this.profiles.get(profileId);
        if (!profile?.sessionData) {
            console.warn(
                `[BrowserAuthManager] No saved session for profile ${profileId}`
            );
            return false;
        }

        const { cookies, localStorage } = profile.sessionData;

        // Restore cookies
        if (cookies.length > 0) {
            await context.addCookies(
                cookies.map((c) => ({
                    name: c.name,
                    value: c.value,
                    domain: c.domain,
                    path: c.path,
                    expires: c.expires,
                    httpOnly: c.httpOnly,
                    secure: c.secure,
                    sameSite: c.sameSite,
                }))
            );
        }

        // Restore localStorage — navigate to the saved domain first so
        // window.localStorage targets the correct origin
        if (Object.keys(localStorage).length > 0) {
            const page = context.pages()[0] ?? await context.newPage();
            try {
                const targetUrl = profile.domain.startsWith("http")
                    ? profile.domain
                    : `https://${profile.domain}`;
                await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 10000 });
                await page.evaluate((data: Record<string, string>) => {
                    for (const [key, value] of Object.entries(data)) {
                        window.localStorage.setItem(key, value);
                    }
                }, localStorage);
            } catch {
                console.warn(
                    `[BrowserAuthManager] Could not restore localStorage for ${profileId}`
                );
            }
        }

        console.log(
            `[BrowserAuthManager] Session restored for profile ${profileId}`
        );
        return true;
    }

    /**
     * Clear a saved session.
     */
    clearSession(profileId: string): void {
        this.profiles.delete(profileId);
        saveProfilesToDisk(this.profiles);
        console.log(`[BrowserAuthManager] Session cleared for profile ${profileId}`);
    }

    /**
     * List all saved auth profiles.
     */
    listProfiles(): AuthProfile[] {
        return Array.from(this.profiles.values());
    }

    /**
     * Check if a profile has a saved session.
     */
    hasSession(profileId: string): boolean {
        return this.profiles.has(profileId) && !!this.profiles.get(profileId)?.sessionData;
    }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _instance: BrowserAuthManager | null = null;

export function getBrowserAuthManager(): BrowserAuthManager {
    if (!_instance) {
        _instance = new BrowserAuthManager();
    }
    return _instance;
}
