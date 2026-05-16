#!/usr/bin/env node
/**
 * Migrate provider_pools.json health state into SQLite.
 *
 * Idempotent: safe to run multiple times.
 * - Reads configs/provider_pools.json
 * - Upserts health fields into data/pool.db accounts table
 * - Migrates unexpired model cooldowns into model_cooldowns table
 *
 * Usage:
 *   node scripts/migrate-pools-to-sqlite.js
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const POOLS_PATH = path.resolve(__dirname, '../configs/provider_pools.json');
const DB_PATH = path.resolve(__dirname, '../data/pool.db');

// Ensure data dir exists
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

if (!fs.existsSync(POOLS_PATH)) {
    console.error(`ERROR: ${POOLS_PATH} not found. Cannot migrate.`);
    process.exit(1);
}

const pools = JSON.parse(fs.readFileSync(POOLS_PATH, 'utf8'));

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');

// Create schema (idempotent)
db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
        id                      INTEGER PRIMARY KEY AUTOINCREMENT,
        provider_type           TEXT    NOT NULL,
        account_index           INTEGER NOT NULL,
        uuid                    TEXT,
        is_healthy              INTEGER NOT NULL DEFAULT 1,
        last_error_time         INTEGER,
        last_error_message      TEXT,
        needs_refresh           INTEGER NOT NULL DEFAULT 0,
        error_count             INTEGER NOT NULL DEFAULT 0,
        scheduled_recovery_time INTEGER,
        UNIQUE(provider_type, account_index)
    );

    CREATE TABLE IF NOT EXISTS model_cooldowns (
        account_id  INTEGER NOT NULL,
        model       TEXT    NOT NULL,
        expires_at  INTEGER NOT NULL,
        PRIMARY KEY (account_id, model),
        FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );
`);

const upsertAccount = db.prepare(`
    INSERT INTO accounts (
        provider_type, account_index, uuid,
        is_healthy, last_error_time, last_error_message,
        needs_refresh, error_count, scheduled_recovery_time
    ) VALUES (
        @provider_type, @account_index, @uuid,
        @is_healthy, @last_error_time, @last_error_message,
        @needs_refresh, @error_count, @scheduled_recovery_time
    )
    ON CONFLICT(provider_type, account_index) DO UPDATE SET
        uuid                    = excluded.uuid,
        is_healthy              = excluded.is_healthy,
        last_error_time         = excluded.last_error_time,
        last_error_message      = excluded.last_error_message,
        needs_refresh           = excluded.needs_refresh,
        error_count             = excluded.error_count,
        scheduled_recovery_time = excluded.scheduled_recovery_time
`);

const getAccountRow = db.prepare(`
    SELECT id FROM accounts WHERE provider_type = ? AND account_index = ?
`);

const upsertCooldown = db.prepare(`
    INSERT INTO model_cooldowns (account_id, model, expires_at)
    VALUES (?, ?, ?)
    ON CONFLICT(account_id, model) DO UPDATE SET expires_at = excluded.expires_at
`);

// Helper: parse a timestamp value (ISO string or ms number) → ms epoch or null
function parseTimestamp(value) {
    if (!value) return null;
    if (typeof value === 'number') return value;
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : ms;
}

let accountCount = 0;
let cooldownCount = 0;
let skippedExpired = 0;
const now = Date.now();

const migrate = db.transaction(() => {
    for (const [providerType, accounts] of Object.entries(pools)) {
        if (!Array.isArray(accounts)) {
            console.log(`  Skipping ${providerType}: not an array`);
            continue;
        }

        accounts.forEach((account, idx) => {
            upsertAccount.run({
                provider_type:           providerType,
                account_index:           idx,
                uuid:                    account.uuid || null,
                is_healthy:              account.isHealthy !== false ? 1 : 0,
                last_error_time:         parseTimestamp(account.lastErrorTime),
                last_error_message:      account.lastErrorMessage || null,
                needs_refresh:           account.needsRefresh ? 1 : 0,
                error_count:             account.errorCount || 0,
                scheduled_recovery_time: parseTimestamp(account.scheduledRecoveryTime),
            });
            accountCount++;

            // Migrate unexpired model cooldowns only
            const cooldowns = account.modelCooldowns;
            if (cooldowns && typeof cooldowns === 'object') {
                const row = getAccountRow.get(providerType, idx);
                if (row) {
                    for (const [model, cooldownUntil] of Object.entries(cooldowns)) {
                        const expiresAt = parseTimestamp(cooldownUntil);
                        if (!expiresAt) continue;
                        if (expiresAt <= now) {
                            skippedExpired++;
                            continue; // already expired — don't migrate
                        }
                        upsertCooldown.run(row.id, model, expiresAt);
                        cooldownCount++;
                    }
                }
            }
        });
    }
});

migrate();
db.close();

console.log(`Migration complete:`);
console.log(`  ${accountCount} accounts upserted`);
console.log(`  ${cooldownCount} active cooldowns migrated`);
console.log(`  ${skippedExpired} expired cooldowns skipped`);
console.log(`  DB: ${DB_PATH}`);
