/**
 * Singleton SQLite database connection for pool health state management.
 *
 * Design:
 * - WAL mode + NORMAL synchronous for performance with durability
 * - Two tables: accounts (health state) + model_cooldowns (per-model rate limits)
 * - Model cooldowns now SURVIVE proxy restarts (previously lost on every restart)
 * - Credential data (tokens, OAuth paths) stays in provider_pools.json
 *
 * Import:
 *   import { getDb, closeDb } from '../utils/db.js';
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '../../data/pool.db');

let _db = null;

/**
 * Returns the singleton database connection, creating it on first call.
 * @returns {Database} better-sqlite3 Database instance
 */
export function getDb() {
    if (_db) return _db;

    // Ensure the data directory exists
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
    _db.pragma('synchronous = NORMAL');
    // Performance pragmas (Context7 better-sqlite3 best practices for WAL mode):
    // - cache_size negative => KiB; -64000 = 64 MB in-memory page cache
    // - temp_store = MEMORY keeps temp/B-tree work in RAM (no disk I/O for sorts)
    // - mmap_size = 256 MB memory-mapped reads (faster than read())
    _db.pragma('cache_size = -64000');
    _db.pragma('temp_store = MEMORY');
    _db.pragma('mmap_size = 268435456');

    _initSchema(_db);
    return _db;
}

/**
 * Closes the database connection. Used in tests and graceful shutdown.
 */
export function closeDb() {
    if (_db) {
        _db.close();
        _db = null;
    }
}

/**
 * Initialises the schema (idempotent — safe to call on every startup).
 * @param {Database} db
 */
function _initSchema(db) {
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
}
