import * as fs from 'fs';
import { getDb } from '../utils/db.js';
import { withFileLock, atomicWriteFile } from '../utils/file-lock.js';

export function initDb(log) {
    try {
        const db = getDb();
        const stmts = {
            upsertAccount: db.prepare(`
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
            `),
            getAccountId: db.prepare(
                `SELECT id FROM accounts WHERE provider_type = ? AND account_index = ?`
            ),
            getAccountByUuid: db.prepare(
                `SELECT id, account_index FROM accounts WHERE provider_type = ? AND uuid = ?`
            ),
            upsertCooldown: db.prepare(`
                INSERT INTO model_cooldowns (account_id, model, expires_at)
                VALUES (?, ?, ?)
                ON CONFLICT(account_id, model) DO UPDATE SET expires_at = excluded.expires_at
            `),
            getCooldowns: db.prepare(
                `SELECT model, expires_at FROM model_cooldowns WHERE account_id = ?`
            ),
            deleteCooldown: db.prepare(
                `DELETE FROM model_cooldowns WHERE account_id = ? AND model = ?`
            ),
            getHealthOverlay: db.prepare(
                `SELECT * FROM accounts WHERE provider_type = ?`
            ),
        };
        log('info', 'SQLite pool state DB initialised');
        return { db, stmts };
    } catch (err) {
        log('warn', `SQLite init failed — falling back to JSON-only mode: ${err.message}`);
        return { db: null, stmts: null };
    }
}

function parseTimestamp(value) {
    if (!value) return null;
    if (typeof value === 'number') return value;
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : ms;
}

export function persistHealthToDb(db, stmts, providerType, providerConfig, accountIndex, log) {
    if (!db || !stmts || accountIndex < 0) return;
    try {
        stmts.upsertAccount.run({
            provider_type:           providerType,
            account_index:           accountIndex,
            uuid:                    providerConfig.uuid || null,
            is_healthy:              providerConfig.isHealthy !== false ? 1 : 0,
            last_error_time:         parseTimestamp(providerConfig.lastErrorTime),
            last_error_message:      providerConfig.lastErrorMessage || null,
            needs_refresh:           providerConfig.needsRefresh ? 1 : 0,
            error_count:             providerConfig.errorCount || 0,
            scheduled_recovery_time: parseTimestamp(providerConfig.scheduledRecoveryTime),
        });
    } catch (err) {
        log('warn', `SQLite health persist failed for ${providerType}[${accountIndex}]: ${err.message}`);
    }
}

export function overlayHealthFromDb(db, stmts, providerStatus, log) {
    if (!db || !stmts) return;
    try {
        for (const providerType in providerStatus) {
            const rows = stmts.getHealthOverlay.all(providerType);
            if (rows.length === 0) continue;

            const rowByUuid  = new Map(rows.filter(r => r.uuid).map(r => [r.uuid, r]));
            const rowByIndex = new Map(rows.map(r => [r.account_index, r]));

            const pool = providerStatus[providerType];
            pool.forEach((providerItem, idx) => {
                const config = providerItem.config;
                const rowByUuidMatch = config.uuid ? rowByUuid.get(config.uuid) : null;
                const rowByIdxMatch  = rowByIndex.get(idx);
                // Only use index match when the row UUID is absent or matches — prevents
                // newly-added accounts from inheriting stale state from a prior account
                // that occupied the same pool index.
                const idxMatchSafe = rowByIdxMatch && (!rowByIdxMatch.uuid || !config.uuid || rowByIdxMatch.uuid === config.uuid);
                const row = rowByUuidMatch || (idxMatchSafe ? rowByIdxMatch : null);
                if (!row) return;

                config.isHealthy              = row.is_healthy === 1;
                config.errorCount             = row.error_count || 0;
                config.needsRefresh           = row.needs_refresh === 1;
                config.lastErrorTime          = row.last_error_time
                    ? new Date(row.last_error_time).toISOString() : null;
                config.lastErrorMessage       = row.last_error_message || null;
                config.scheduledRecoveryTime  = row.scheduled_recovery_time
                    ? new Date(row.scheduled_recovery_time).toISOString() : null;

                const accountRow = stmts.getAccountId.get(providerType, row.account_index);
                if (accountRow) {
                    const cooldowns = stmts.getCooldowns.all(accountRow.id);
                    const now = Date.now();
                    if (!config.modelCooldowns || typeof config.modelCooldowns !== 'object' || Array.isArray(config.modelCooldowns)) config.modelCooldowns = {};
                    for (const cd of cooldowns) {
                        if (cd.expires_at > now) {
                            config.modelCooldowns[cd.model] = new Date(cd.expires_at).toISOString();
                        }
                    }
                }
            });
        }
        log('info', 'Health state overlaid from SQLite');
    } catch (err) {
        log('warn', `SQLite health overlay failed: ${err.message}`);
    }
}

export function debouncedSave(providerType, state, flushFn) {
    state.pendingSaves.add(providerType);
    if (state.saveTimer) clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => flushFn(), state.saveDebounceTime);
}

export async function flushPendingSaves(providerStatus, state, globalConfig, log) {
    if (state.saveTimer) { clearTimeout(state.saveTimer); state.saveTimer = null; }
    const filePath = globalConfig.PROVIDER_POOLS_FILE_PATH || 'configs/provider_pools.json';
    await withFileLock(filePath, async (checkValidity) => {
        const typesToSave = Array.from(state.pendingSaves);
        if (typesToSave.length === 0) return;
        state.pendingSaves.clear();
        try {
            let currentPools = {};
            try {
                const fileContent = await fs.promises.readFile(filePath, 'utf8');
                currentPools = JSON.parse(fileContent);
            } catch (readError) {
                if (readError.code !== 'ENOENT') throw readError;
                log('info', 'configs/provider_pools.json does not exist, creating new file.');
            }
            checkValidity();
            for (const providerType of typesToSave) {
                if (providerStatus[providerType]) {
                    currentPools[providerType] = providerStatus[providerType].map(p => {
                        const config = { ...p.config };
                        if (config.lastUsed instanceof Date) config.lastUsed = config.lastUsed.toISOString();
                        if (config.lastErrorTime instanceof Date) config.lastErrorTime = config.lastErrorTime.toISOString();
                        if (config.lastHealthCheckTime instanceof Date) config.lastHealthCheckTime = config.lastHealthCheckTime.toISOString();
                        return config;
                    });
                } else {
                    log('warn', `Attempted to save unknown providerType: ${providerType}`);
                }
            }
            await atomicWriteFile(filePath, JSON.stringify(currentPools, null, 2), { encoding: 'utf8', mode: 0o600 });
            log('info', `configs/provider_pools.json updated for types: ${typesToSave.join(', ')}`);
        } catch (error) {
            log('error', `Failed to write provider_pools.json: ${error.message}`);
        }
    });
}
