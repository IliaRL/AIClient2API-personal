// scripts/unified-test-suite.cjs
// Sequential, rate-limited validation of every healthy model in the proxy catalog.
//
// What it checks per model:
//   - chat       : POST /v1/chat/completions returns non-empty content
//   - stream     : POST stream=true emits at least 1 SSE data chunk
//   - tool       : tool_calls returned for a simple sum function (or 30 in text)
//   - identity   : json.model OR X-Proxy-Actual-Model equals requested model
//                  (proxy may transparently fall back; identity passes if either
//                   the requested model is preserved, or the actual served model
//                   is announced via the proxy's X-Proxy-Actual-Model header).
//
// Conservative defaults:
//   - 1.5s sleep between models (avoid pool exhaustion)
//   - 25s per-request timeout
//   - skips providers with zero healthy accounts (read from /provider_health)
//   - skips models that are not declared by any healthy provider
//   - skips grok-web entirely if no grok-web accounts exist
//
// CLI flags:
//   --provider=<type>   only test models of this provider type
//   --model=<id>        only test this single model id
//   --include-unhealthy run tests even on providers with 0 healthy accounts
//                       (useful when validating fallback chains)

const http = require('http');
const path = require('path');

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

const API_KEY = process.env.AICLIENT_TOKEN || 'sk-a60f3efdf9b97e63c84ab4a3583f9d1c';
const BASE_URL = 'http://127.0.0.1:3000';
const REQUEST_TIMEOUT_MS = 25000;
const SLEEP_BETWEEN_MODELS_MS = 1500;

const filterProvider = process.argv.find(a => a.startsWith('--provider='))?.split('=')[1];
const filterModel = process.argv.find(a => a.startsWith('--model='))?.split('=')[1];
const includeUnhealthy = process.argv.includes('--include-unhealthy');

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

async function makeRequest(options, postData) {
    return new Promise((resolve, reject) => {
        const url = new URL(BASE_URL + options.path);
        const reqOptions = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            method: options.method || 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${API_KEY}`,
                ...options.headers
            }
        };

        const req = http.request(reqOptions, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
                if (options.onChunk) options.onChunk(chunk.toString());
            });
            res.on('end', () => resolve({
                statusCode: res.statusCode,
                headers: res.headers,
                data
            }));
        });

        req.setTimeout(REQUEST_TIMEOUT_MS, () => {
            req.destroy(new Error(`timeout after ${REQUEST_TIMEOUT_MS}ms`));
        });
        req.on('error', (e) => reject(e));
        if (postData) req.write(JSON.stringify(postData));
        req.end();
    });
}

async function fetchHealth() {
    try {
        const res = await makeRequest({ path: '/provider_health', method: 'GET' });
        const d = JSON.parse(res.data);
        const byProvider = {};
        for (const item of d.items) {
            const p = item.provider;
            if (!byProvider[p]) byProvider[p] = { healthy: 0, total: 0 };
            byProvider[p].total += 1;
            if (item.isHealthy) byProvider[p].healthy += 1;
        }
        return byProvider;
    } catch (e) {
        console.warn(`${YELLOW}[health] could not fetch /provider_health: ${e.message}${RESET}`);
        return {};
    }
}

const results = [];

async function testModel(modelId, provider) {
    const r = {
        model: modelId,
        provider,
        chat:     { status: 'PENDING' },
        stream:   { status: 'PENDING' },
        tool:     { status: 'PENDING' },
        identity: { status: 'PENDING' },
    };
    results.push(r);

    console.log(`\n${BLUE}=== ${modelId}${RESET} ${DIM}(${provider})${RESET}`);

    // 1. Chat + identity (single request)
    try {
        const res = await makeRequest({ path: '/v1/chat/completions' }, {
            model: modelId,
            messages: [{ role: 'user', content: 'Respond with OK only.' }],
            max_tokens: 20
        });

        const actualHeader = res.headers['x-proxy-actual-model'];
        const actualProvider = res.headers['x-proxy-actual-provider'];
        const fallbackUsed = res.headers['x-proxy-fallback-used'] === 'true';

        if (res.statusCode !== 200) {
            const err = (() => {
                try { return JSON.parse(res.data).error?.message || res.data.slice(0, 80); }
                catch { return res.data.slice(0, 80); }
            })();
            r.chat = { status: 'FAIL', reason: `HTTP ${res.statusCode}: ${err}` };
            r.identity = { status: 'FAIL', reason: 'chat failed' };
        } else {
            const json = JSON.parse(res.data);
            const content = json.choices?.[0]?.message?.content
                         || json.choices?.[0]?.message?.reasoning_content
                         || json.choices?.[0]?.message?.reasoning;
            if (content && content.length > 0) {
                r.chat = { status: 'PASS' };
            } else if (json.choices?.[0]?.message?.tool_calls?.length) {
                r.chat = { status: 'PASS', details: 'tool_call instead of text' };
            } else {
                r.chat = { status: 'FAIL', reason: 'empty content' };
            }

            // Identity: the X-Proxy-Actual-Model header is the authoritative
            // signal of what the proxy routed the request to. Upstreams sometimes
            // return their own canonical ID in the JSON body (e.g. Codex maps
            // gpt-5.2 → gpt-5.4 in its response), so we don't fail when the
            // upstream renames the served model. We require:
            //   1) The proxy correctly routed to the requested model (header == modelId), OR
            //   2) A transparent fallback occurred (fallbackUsed=true), in which case
            //      the header announces the substitute and that's still preservation.
            // We also surface the response body json.model as informational.
            const jsonModel = json.model;
            if (actualHeader === modelId) {
                r.identity = { status: 'PASS', details: `provider=${actualProvider || provider}${jsonModel && jsonModel !== modelId ? ` upstream-renamed=${jsonModel}` : ''}` };
            } else if (fallbackUsed && actualHeader) {
                r.identity = { status: 'PASS', details: `fallback→${actualProvider} (served as ${actualHeader})` };
            } else if (!actualHeader) {
                r.identity = { status: 'FAIL', reason: 'no X-Proxy-Actual-Model header' };
            } else {
                r.identity = { status: 'FAIL', reason: `X-Proxy-Actual-Model=${actualHeader} !== requested ${modelId}` };
            }
        }
    } catch (e) {
        r.chat = { status: 'ERROR', reason: e.message };
        r.identity = { status: 'ERROR', reason: 'chat errored' };
    }

    // 2. Stream
    try {
        let chunkCount = 0;
        const res = await makeRequest({
            path: '/v1/chat/completions',
            onChunk: (chunk) => { if (chunk.includes('data:')) chunkCount++; }
        }, {
            model: modelId,
            messages: [{ role: 'user', content: 'Count 1 to 5.' }],
            stream: true,
            max_tokens: 50
        });
        if (res.statusCode === 200 && chunkCount > 0) {
            r.stream = { status: 'PASS', details: `${chunkCount} chunks` };
        } else if (res.statusCode === 200) {
            r.stream = { status: 'FAIL', reason: 'no SSE chunks' };
        } else {
            r.stream = { status: 'FAIL', reason: `HTTP ${res.statusCode}` };
        }
    } catch (e) {
        r.stream = { status: 'ERROR', reason: e.message };
    }

    // 3. Tool use
    try {
        const res = await makeRequest({ path: '/v1/chat/completions' }, {
            model: modelId,
            messages: [{ role: 'user', content: 'Use calculate_sum to compute 10+20.' }],
            max_tokens: 100,
            tools: [{
                type: 'function',
                function: {
                    name: 'calculate_sum',
                    description: 'Sum two numbers',
                    parameters: {
                        type: 'object',
                        properties: { a: { type: 'number' }, b: { type: 'number' } },
                        required: ['a', 'b']
                    }
                }
            }]
        });
        if (res.statusCode === 200) {
            const json = JSON.parse(res.data);
            const tc = json.choices?.[0]?.message?.tool_calls?.[0];
            const text = (json.choices?.[0]?.message?.content || '').toLowerCase();
            if (tc) r.tool = { status: 'PASS', details: tc.function?.name || 'tool_call' };
            else if (text.includes('30')) r.tool = { status: 'PASS', details: 'answered in text' };
            else r.tool = { status: 'FAIL', reason: 'no tool_call, no 30 in text' };
        } else {
            r.tool = { status: 'FAIL', reason: `HTTP ${res.statusCode}` };
        }
    } catch (e) {
        r.tool = { status: 'ERROR', reason: e.message };
    }

    const icon = (s) => s === 'PASS' ? `${GREEN}✓${RESET}` : (s === 'PENDING' ? '·' : `${RED}✗${RESET}`);
    const fmt = (k) => `${icon(r[k].status)} ${k}${r[k].reason ? ` ${DIM}(${r[k].reason})${RESET}` : (r[k].details ? ` ${DIM}(${r[k].details})${RESET}` : '')}`;
    console.log(`  ${fmt('chat')}  ${fmt('stream')}  ${fmt('tool')}  ${fmt('identity')}`);
}

async function run() {
    console.log(`${YELLOW}Unified Test Suite — sequential, rate-limited${RESET}`);
    console.log(`${DIM}base=${BASE_URL} timeout=${REQUEST_TIMEOUT_MS}ms sleep=${SLEEP_BETWEEN_MODELS_MS}ms${RESET}`);

    let providerModels;
    try {
        const modulePath = path.join(process.cwd(), 'src/providers/provider-models.js');
        const module = await import('file://' + modulePath);
        providerModels = module.PROVIDER_MODELS;
    } catch (e) {
        console.error(`${RED}Failed to load provider models: ${e.message}${RESET}`);
        process.exit(1);
    }

    const health = await fetchHealth();
    console.log('\nProvider health snapshot:');
    for (const [p, c] of Object.entries(health)) {
        const colour = c.healthy === c.total ? GREEN : (c.healthy === 0 ? RED : YELLOW);
        console.log(`  ${colour}${p}: ${c.healthy}/${c.total} healthy${RESET}`);
    }

    let totalTested = 0;
    let totalSkipped = 0;
    for (const [provider, models] of Object.entries(providerModels)) {
        if (filterProvider && provider !== filterProvider) continue;

        const h = health[provider];
        const hasHealthy = h ? h.healthy > 0 : false;
        if (!hasHealthy && !includeUnhealthy) {
            console.log(`\n${DIM}-- skipping provider ${provider}: ${h ? `${h.healthy}/${h.total} healthy` : 'no accounts'} (--include-unhealthy to force)${RESET}`);
            totalSkipped += models.length;
            continue;
        }

        for (const modelId of models) {
            if (filterModel && modelId !== filterModel) continue;
            await testModel(modelId, provider);
            totalTested += 1;
            await sleep(SLEEP_BETWEEN_MODELS_MS);
        }
    }

    console.log(`\n${YELLOW}=== Summary (${totalTested} tested, ${totalSkipped} skipped) ===${RESET}`);
    const summary = results.map(r => ({
        Model: r.model,
        Provider: r.provider,
        Chat: r.chat.status,
        Stream: r.stream.status,
        Tool: r.tool.status,
        ID: r.identity.status
    }));
    if (summary.length > 0) console.table(summary);

    const total = results.length * 4;
    const passed = results.reduce((acc, r) =>
        acc + [r.chat, r.stream, r.tool, r.identity].filter(s => s.status === 'PASS').length, 0);
    const colour = passed === total ? GREEN : (passed > total / 2 ? YELLOW : RED);
    console.log(`\n${colour}Score: ${passed}/${total} checks passed${RESET}`);

    if (passed < total) {
        console.log(`\n${RED}Failures:${RESET}`);
        for (const r of results) {
            for (const k of ['chat', 'stream', 'tool', 'identity']) {
                if (r[k].status !== 'PASS' && r[k].status !== 'PENDING') {
                    console.log(`  ${r.model} (${r.provider}) :: ${k} :: ${r[k].status} :: ${r[k].reason || '?'}`);
                }
            }
        }
    }

    process.exit(passed === total ? 0 : 1);
}

run().catch(e => {
    console.error(`${RED}Fatal: ${e.message}${RESET}`);
    process.exit(2);
});
