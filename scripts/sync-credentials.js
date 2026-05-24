import fs from 'fs';
import path from 'path';
import url from 'url';

// Define target path
const TARGET_PATH = '/Users/ilialiston/Master-C-Code-Config/Credentials.md';
const PROJECT_DIR = '/Users/ilialiston/AIClient2API';

export async function syncCredentials(options = {}) {
    const dryRun = options.dryRun || false;
    const verbose = options.verbose ?? true;

    const log = (level, message) => {
        if (verbose) {
            console.log(`[CredentialsSync] [${level.toUpperCase()}] ${message}`);
        }
    };

    log('info', `Starting credential sync... Target: ${TARGET_PATH} (Dry run: ${dryRun})`);

    // Load configs
    const configPath = path.normalize(path.join(PROJECT_DIR, 'configs', 'config.json'));
    const poolsPath = path.normalize(path.join(PROJECT_DIR, 'configs', 'provider_pools.json'));

    if (!fs.existsSync(configPath)) {
        throw new Error(`Config file not found: ${configPath}`);
    }
    if (!fs.existsSync(poolsPath)) {
        throw new Error(`Pools file not found: ${poolsPath}`);
    }

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const pools = JSON.parse(fs.readFileSync(poolsPath, 'utf8'));

    // Master API Key
    const requiredApiKey = config.REQUIRED_API_KEY || '';

    // Simple API Keys from pool arrays
    const getApiKey = (providerType) => {
        const pool = Object.hasOwn(pools, providerType) ? pools[providerType] : [];
        const item = pool[0];
        return item?.OPENAI_API_KEY || '';
    };

    const nvidiaKey = getApiKey('nvidia-nim');
    const githubKey = getApiKey('github-models');
    const openrouterKey = getApiKey('openai-custom');

    // Helper to resolve and read JSON credential files
    const readCredFile = (relPath) => {
        try {
            const absPath = path.normalize(path.resolve(PROJECT_DIR, relPath));
            if (!absPath.startsWith(path.normalize(PROJECT_DIR))) {
                throw new Error('Path traversal detected');
            }
            if (fs.existsSync(absPath)) {
                return JSON.parse(fs.readFileSync(absPath, 'utf8'));
            }
        } catch (e) {
            log('warn', `Failed to read credential file ${relPath}: ${e.message}`);
        }
        return null;
    };

    // Pre-resolve OAuth credential objects
    const resolvedOAuth = {
        'claude-kiro-oauth': [],
        'openai-codex-oauth': [],
        'gemini-cli-oauth': [],
        'gemini-antigravity': []
    };

    // 1. Claude Kiro OAuth
    const kiroPool = pools['claude-kiro-oauth'] || [];
    for (const item of kiroPool) {
        if (item.KIRO_OAUTH_CREDS_FILE_PATH) {
            const credData = readCredFile(item.KIRO_OAUTH_CREDS_FILE_PATH);
            if (credData) {
                resolvedOAuth['claude-kiro-oauth'].push({
                    customName: item.customName,
                    data: credData
                });
            }
        }
    }

    // 2. OpenAI Codex OAuth
    const codexPool = pools['openai-codex-oauth'] || [];
    for (const item of codexPool) {
        if (item.CODEX_OAUTH_CREDS_FILE_PATH) {
            const credData = readCredFile(item.CODEX_OAUTH_CREDS_FILE_PATH);
            if (credData) {
                resolvedOAuth['openai-codex-oauth'].push({
                    customName: item.customName,
                    data: credData
                });
            }
        }
    }

    // 3. Gemini CLI OAuth
    const geminiCliPool = pools['gemini-cli-oauth'] || [];
    for (const item of geminiCliPool) {
        if (item.GEMINI_OAUTH_CREDS_FILE_PATH) {
            const credData = readCredFile(item.GEMINI_OAUTH_CREDS_FILE_PATH);
            if (credData) {
                resolvedOAuth['gemini-cli-oauth'].push({
                    customName: item.customName,
                    data: credData
                });
            }
        }
    }

    // 4. Gemini Antigravity
    const antigravityPool = pools['gemini-antigravity'] || [];
    for (const item of antigravityPool) {
        if (item.ANTIGRAVITY_OAUTH_CREDS_FILE_PATH) {
            const credData = readCredFile(item.ANTIGRAVITY_OAUTH_CREDS_FILE_PATH);
            if (credData) {
                resolvedOAuth['gemini-antigravity'].push({
                    customName: item.customName,
                    data: credData
                });
            }
        }
    }

    // Read existing Credentials.md
    if (!fs.existsSync(TARGET_PATH)) {
        throw new Error(`Master Credentials file not found: ${TARGET_PATH}`);
    }

    const mdContent = fs.readFileSync(TARGET_PATH, 'utf8');
    const lines = mdContent.split(/\r?\n/);

    const outputLines = [];
    let currentProvider = null;
    let currentAccount = null;
    let inJsonBlock = false;
    let updateCount = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Parse headings to track context
        if (line.startsWith('### ')) {
            const providerName = line.substring(4).trim().toLowerCase();
            if (['claude-kiro-oauth', 'openai-codex-oauth', 'gemini-cli-oauth', 'gemini-antigravity'].includes(providerName)) {
                currentProvider = providerName;
                currentAccount = null;
                log('debug', `Entered provider context: ${currentProvider}`);
            } else {
                currentProvider = null;
                currentAccount = null;
            }
            outputLines.push(line);
            continue;
        }

        if (line.startsWith('#### ')) {
            if (currentProvider) {
                currentAccount = line.substring(5).trim();
                log('debug', `Entered account context: ${currentAccount} under ${currentProvider}`);
            }
            outputLines.push(line);
            continue;
        }

        // Detect JSON Code block
        if (currentProvider && currentAccount && line.trim() === '```json') {
            inJsonBlock = true;
            // Fetch the updated credentials
            let newPayload = null;

            if (currentProvider === 'claude-kiro-oauth') {
                if (currentAccount.toLowerCase() === 'account-3') {
                    newPayload = resolvedOAuth['claude-kiro-oauth'][0]?.data;
                } else if (currentAccount.toLowerCase() === 'account 2') {
                    newPayload = resolvedOAuth['claude-kiro-oauth'][1]?.data;
                } else if (currentAccount.toLowerCase() === 'account 3') {
                    newPayload = resolvedOAuth['claude-kiro-oauth'][2]?.data;
                }
            } else if (currentProvider === 'openai-codex-oauth') {
                if (currentAccount.toLowerCase() === 'account 1') {
                    newPayload = resolvedOAuth['openai-codex-oauth'][0]?.data;
                }
            } else if (currentProvider === 'gemini-cli-oauth') {
                const match = currentAccount.match(/Account\s+(\d+)/i);
                if (match) {
                    const index = parseInt(match[1]) - 1;
                    newPayload = resolvedOAuth['gemini-cli-oauth'][index]?.data;
                }
            } else if (currentProvider === 'gemini-antigravity') {
                const targetEmail = currentAccount.trim().toLowerCase();
                const matchedNode = resolvedOAuth['gemini-antigravity'].find(
                    node => node.customName && node.customName.trim().toLowerCase() === targetEmail
                );
                newPayload = matchedNode?.data;
            }

            // Read and collect old JSON payload lines to compare and check if it changed
            const oldPayloadLines = [];
            let j = i + 1;
            while (j < lines.length && lines[j].trim() !== '```') {
                oldPayloadLines.push(lines[j]);
                j++;
            }
            const oldPayloadStr = oldPayloadLines.join('\n').trim();

            if (newPayload) {
                const newPayloadStr = JSON.stringify(newPayload, null, 2);
                const hasChanged = oldPayloadStr !== newPayloadStr.trim();

                outputLines.push('```json');
                outputLines.push(newPayloadStr);
                outputLines.push('```');

                if (hasChanged) {
                    updateCount++;
                    log('info', `Synced JSON block (updated) for ${currentProvider} -> ${currentAccount}`);
                } else {
                    log('debug', `JSON block unchanged for ${currentProvider} -> ${currentAccount}`);
                }
            } else {
                log('warn', `No refreshed payload found for ${currentProvider} -> ${currentAccount}, preserving existing.`);
                outputLines.push(line);
                // Copy the existing block
                i++;
                while (i < lines.length && lines[i].trim() !== '```') {
                    outputLines.push(lines[i]);
                    i++;
                }
                if (i < lines.length) {
                    outputLines.push(lines[i]);
                }
            }

            // Fast-forward outer loop index `i` to the end of this block
            i = j;
            inJsonBlock = false;
            continue;
        }

        // Handle inline API Key replacements when not in code blocks
        if (!inJsonBlock) {
            let replacedLine = line;

            if (line.includes('REQUIRED_API_KEY') && requiredApiKey) {
                replacedLine = line.replace(/`([^`]+)`/, `\`${requiredApiKey}\``);
                if (replacedLine !== line) {
                    updateCount++;
                    log('info', `Synced REQUIRED_API_KEY`);
                }
            } else if (line.includes('NVIDIA_NIM API Key') && nvidiaKey) {
                replacedLine = line.replace(/`([^`]+)`/, `\`${nvidiaKey}\``);
                if (replacedLine !== line) {
                    updateCount++;
                    log('info', `Synced NVIDIA_NIM API Key`);
                }
            } else if (line.includes('GitHub PAT API Key') && githubKey) {
                replacedLine = line.replace(/`([^`]+)`/, `\`${githubKey}\``);
                if (replacedLine !== line) {
                    updateCount++;
                    log('info', `Synced GitHub PAT API Key`);
                }
            } else if (line.includes('Open-router API Key') && openrouterKey) {
                replacedLine = line.replace(/`([^`]+)`/, `\`${openrouterKey}\``);
                if (replacedLine !== line) {
                    updateCount++;
                    log('info', `Synced Open-router API Key`);
                }
            }

            outputLines.push(replacedLine);
        } else {
            outputLines.push(line);
        }
    }

    if (updateCount === 0) {
        log('info', 'No credentials changed; Master Credentials file is already up to date.');
        return false;
    }

    const newMdContent = outputLines.join('\n');

    if (!dryRun) {
        fs.writeFileSync(TARGET_PATH, newMdContent, 'utf8');
        log('info', `Successfully synced ${updateCount} credential(s) to ${TARGET_PATH}`);
    } else {
        log('info', `[DRY-RUN] Would have written ${updateCount} updated credential(s) to ${TARGET_PATH}`);
    }

    return true;
}

// Support CLI execution directly
const isMain = import.meta.url === url.pathToFileURL(process.argv[1]).href;
if (isMain) {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run') || args.includes('-d');
    
    syncCredentials({ dryRun })
        .then((updated) => {
            process.exit(0);
        })
        .catch(err => {
            console.error(`[CredentialsSync] [ERROR] Sync failed:`, err.message);
            process.exit(1);
        });
}
