/**
 * Secrets Store — Encrypted Key-Value Storage
 *
 * AES-256-GCM encrypted storage for API keys and tokens.
 * Unlike plain memories, secrets are:
 * - Encrypted at rest using a key derived from SECRETS_ENCRYPTION_KEY env var
 * - Not visible in the agent's context dump
 * - Only accessible via store_secret / get_secret skill calls
 *
 * Storage: data/secrets.json (gitignored)
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

// ── Constants ──────────────────────────────────────────────────────────────

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32; // 256 bits
const SECRETS_FILE = path.join(process.cwd(), "data", "secrets.json");

// ── Types ──────────────────────────────────────────────────────────────────

interface EncryptedValue {
    /** Base64-encoded initialization vector */
    iv: string;
    /** Base64-encoded encrypted data */
    data: string;
    /** Base64-encoded authentication tag */
    tag: string;
}

interface SecretsFile {
    version: 1;
    secrets: Record<string, EncryptedValue>;
}

// ── Encryption Key ─────────────────────────────────────────────────────────

function getEncryptionKey(): Buffer {
    let key = process.env.SECRETS_ENCRYPTION_KEY;

    if (!key) {
        // Auto-generate a key and warn (for development)
        // In production, this should be set explicitly
        key = crypto.randomBytes(KEY_LENGTH).toString("hex");
        console.warn(
            "[secrets] No SECRETS_ENCRYPTION_KEY set — auto-generated a temporary key.",
            "Secrets will be lost on restart. Set SECRETS_ENCRYPTION_KEY in .env.local for persistence."
        );
        process.env.SECRETS_ENCRYPTION_KEY = key;
    }

    // Derive a 32-byte key from the env var using SHA-256
    return crypto.createHash("sha256").update(key).digest();
}

// ── Encrypt / Decrypt ──────────────────────────────────────────────────────

function encrypt(plaintext: string): EncryptedValue {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(plaintext, "utf8", "base64");
    encrypted += cipher.final("base64");

    return {
        iv: iv.toString("base64"),
        data: encrypted,
        tag: cipher.getAuthTag().toString("base64"),
    };
}

function decrypt(encrypted: EncryptedValue): string {
    const key = getEncryptionKey();
    const iv = Buffer.from(encrypted.iv, "base64");
    const tag = Buffer.from(encrypted.tag, "base64");
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(encrypted.data, "base64", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
}

// ── File I/O ───────────────────────────────────────────────────────────────

function ensureDataDir(): void {
    const dir = path.dirname(SECRETS_FILE);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function readSecrets(): SecretsFile {
    try {
        if (fs.existsSync(SECRETS_FILE)) {
            const raw = fs.readFileSync(SECRETS_FILE, "utf8");
            return JSON.parse(raw) as SecretsFile;
        }
    } catch (err) {
        console.error("[secrets] Failed to read secrets file:", err);
    }
    return { version: 1, secrets: {} };
}

function writeSecrets(data: SecretsFile): void {
    ensureDataDir();
    fs.writeFileSync(SECRETS_FILE, JSON.stringify(data, null, 2), "utf8");
}

// ── Public API ─────────────────────────────────────────────────────────────

export const secretsStore = {
    /**
     * Store a secret (encrypts before writing to disk).
     * Overwrites if the name already exists.
     */
    store(name: string, value: string): void {
        const secrets = readSecrets();
        secrets.secrets[name] = encrypt(value);
        writeSecrets(secrets);
    },

    /**
     * Retrieve a secret by name (decrypts from disk).
     * Returns null if not found.
     */
    get(name: string): string | null {
        const secrets = readSecrets();
        const entry = secrets.secrets[name];
        if (!entry) return null;

        try {
            return decrypt(entry);
        } catch (err) {
            console.error(`[secrets] Failed to decrypt "${name}":`, err);
            return null;
        }
    },

    /**
     * List all secret names (never returns values).
     */
    list(): string[] {
        const secrets = readSecrets();
        return Object.keys(secrets.secrets);
    },

    /**
     * Delete a secret by name.
     * Returns true if deleted, false if not found.
     */
    delete(name: string): boolean {
        const secrets = readSecrets();
        if (!(name in secrets.secrets)) return false;
        delete secrets.secrets[name];
        writeSecrets(secrets);
        return true;
    },

    /**
     * Check if a secret exists by name.
     */
    has(name: string): boolean {
        const secrets = readSecrets();
        return name in secrets.secrets;
    },
};
