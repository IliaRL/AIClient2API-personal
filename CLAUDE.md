# CLAUDE.md

AIClient2API is a Node.js proxy on `http://localhost:3000` that unifies all available models from all providers (Kiro, Google Antigravity, Gemini CLI, OpenRouter, NVIDIA NIM, GitHub Models, OpenAI Codex) behind a single OpenAI/Anthropic/Gemini-compatible API.

For deep operational expertise, invoke `/aiclient-master`.
For routing diagnostics, invoke `/proxy-repair`.
For config/credential workflows, invoke `/config`.

---

## Non-Negotiable Rules
1. **Port is 3000.** Never change `SERVER_PORT`.
2. **`listModels()` is static & synchronous.** `src/providers/provider-models.js` MUST NOT use `await` or live API calls (circular import TDZ via `adapter.js → gemini-core.js → provider-models.js`).
3. **No `needsReauth: true` on static-key providers** (OpenRouter, NIM, GitHub, Codex).
4. **Secrets safety.** `configs/provider_pools.json` contains live tokens. NEVER `git add -A`.
5. **Restart via `./scripts/safe-restart.sh` only.** Kills only the port-3000 listener.
6. **OpenRouter (`openai-custom`) models** come ONLY from `configs/custom_models.json`.
7. **Keep `startupRun: false`** in `configs/config.json` to prevent startup 429 storms.
8. **Model IDs must be versioned.** Use `claude-sonnet-4-5-20250929`, not shorthand like `claude-sonnet-4-6`.
9. **Health check models must be live.** `DEFAULT_HEALTH_CHECK_MODELS` in `provider-pool-manager.js` and `defaultCheckModel` in `provider-utils.js` must reference verified-live model IDs — stale IDs cause scheduled health checks to always fail and mark healthy providers as unhealthy.
10. **`modelCooldowns` in `provider_pools.json` must be objects `{}`**, never strings. If you see `"[object Object]"` as the value, clean it with `python3 -c "import json; p=json.load(open('configs/provider_pools.json')); [acc.update({'modelCooldowns':{}}) for ptype in p for acc in (p[ptype] if isinstance(p[ptype],list) else []) if not isinstance(acc.get('modelCooldowns',{}),dict)]; json.dump(p,open('configs/provider_pools.json','w'),indent=2)"`.

---

## Quick Commands
```bash
# Restart (safely — never crashes Claude Code session)
./scripts/safe-restart.sh

# First launch (fresh checkout or after manual kill)
npm start > /tmp/aiclient.log 2>&1 &
for i in $(seq 1 30); do curl -sf http://127.0.0.1:3000/api/help -o /dev/null && echo "ready" && break; sleep 1; done

# Health check
curl -s http://127.0.0.1:3000/provider_health | python3 -c "
import sys,json; d=json.load(sys.stdin)
bad=[i for i in d['items'] if not i['isHealthy']]
print(f'Health: {len(d[\"items\"])-len(bad)}/{len(d[\"items\"])} healthy')
[print(f'  UNHEALTHY: {i[\"provider\"]} — {str(i.get(\"lastErrorMessage\",\"\"))[:70]}') for i in bad]"

# List all exposed models
curl -s http://127.0.0.1:3000/v1/models \
  -H "Authorization: Bearer $(python3 -c "import json;print(json.load(open('configs/config.json'))['REQUIRED_API_KEY'])")" \
  | jq -r '.data[].id' | sort

# Test a specific model (use --data-raw to avoid zsh expansion bugs)
curl -sm 30 -X POST http://127.0.0.1:3000/v1/messages \
  -H "Authorization: Bearer sk-a60f3efdf9b97e63c84ab4a3583f9d1c" \
  -H "Content-Type: application/json" \
  --data-raw '{"model":"claude-sonnet-4-5","max_tokens":20,"messages":[{"role":"user","content":"hi"}]}'

# Run full test suite
node scripts/unified-test-suite.cjs

# Targeted model test
node scripts/unified-test-suite.cjs --model=<model-id>

# Reset pool state (all accounts back to healthy, clear cooldowns)
python3 -c "
import json
p = json.load(open('configs/provider_pools.json'))
for ptype, accounts in p.items():
    for acc in (accounts if isinstance(accounts, list) else []):
        acc.update({'isHealthy': True, 'lastErrorTime': None, 'lastErrorMessage': None, 'needsRefresh': False, 'modelCooldowns': {}})
        acc.pop('scheduledRecoveryTime', None)
with open('configs/provider_pools.json', 'w') as f: json.dump(p, f, indent=2)
print('Pool reset complete')
"
```

---

## Architecture & Key Files
| Concept | File | What it does |
|---|---|---|
| Adapter registry | `src/providers/adapter.js` | Registers every provider; must be updated when adding new ones |
| Static model catalog | `src/providers/provider-models.js` | Authoritative list of all models; sync/static only (no await) |
| Fallback chains | `configs/config.json` (`modelFallbackMapping`, `providerFallbackChain`) | Per-model and per-provider cross-provider fallback order |
| Pool manager | `src/providers/provider-pool-manager.js` | Account rotation, 429 cooldowns, per-model cooldowns, scoring, SQLite state |
| SQLite pool state | `src/utils/db.js` | Persistent health/cooldown state across restarts; overlaid onto pool at startup |
| File lock | `src/utils/file-lock.js` | Atomic writes for `provider_pools.json`; prevents concurrent-write corruption |
| Protocol conversion | `src/converters/strategies/` | OpenAI ↔ Anthropic ↔ Gemini translation |
| Converter utils | `src/converters/utils.js` | `flattenToolArguments` (shared by all converters), `cleanJsonSchemaForOpenAI` |
| Converter registration | `src/converters/register-converters.js` | Wires converter strategies into the dispatch table |
| Routing | `src/services/service-manager.js` | Model→provider resolution, AUTO mode, prefix routing, catalog reverse-lookup |
| Request dispatch | `src/handlers/api-handlers.js` | HTTP request entry point; delegates to stream/unary handlers |
| Error handling | `src/utils/common.js` | Stream/unary error → cooldown → retry logic; `_applyBadRequestCooldown` |
| Provider health config | `src/utils/provider-utils.js` | `PROVIDER_MAPPINGS` — health check models and credential path keys per provider |
| Credentials | `configs/provider_pools.json` | Live tokens/OAuth; never commit carelessly |
| OpenRouter models | `configs/custom_models.json` | Only source for `openai-custom` models |
| Antigravity core | `src/providers/gemini/antigravity-core.js` | `geminiToAntigravity()`, `callApi()`, `streamApi()` |
| Kiro core | `src/providers/claude/claude-kiro.js` | `buildCodewhispererRequest()` ~:1047; model name map :205-212 |
| Gemini CLI core | `src/providers/gemini/gemini-core.js` | OAuth refresh, stream parsing, anti-truncation loop |

---

## Current Provider State (2026-05-16)
| Provider | Accounts | Status | Live Models |
|---|---|---|---|
| `claude-kiro-oauth` | 1/1 | ✅ | `claude-haiku-4-5`, `claude-sonnet-4-5`, `claude-sonnet-4-5-20250929` |
| `gemini-antigravity` | 13/14 | ✅ | `gemini-3-flash`, `gemini-3.1-pro-high`, `gemini-3.1-pro-low`, `gemini-claude-sonnet-4-6`, `gemini-claude-opus-4-6-thinking` |
| `gemini-cli-oauth` | 12/14 | ✅ | `gemini-3.1-pro-preview`, `gemini-3-flash-preview`, `gemini-3.1-flash-lite-preview`, `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-2.5-flash-lite` (gemma removed 2026-05-15) |
| `nvidia-nim` | 1/1 | ✅ | 10 models — see `provider-models.js` |
| `openai-codex-oauth` | 1/1 | ✅ | `gpt-5.2`, `gpt-5.3-codex`, `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.5` |
| `github-models` | 1/1 | ✅ | 10 models: `gpt-4o`, `gpt-4o-mini`, `gpt-4.1`, `gpt-4.1-mini`, `gpt-4.1-nano`, `DeepSeek-R1`, `DeepSeek-V3-0324`, `Meta-Llama-3.1-405B-Instruct`, `Meta-Llama-3.1-8B-Instruct`, `Phi-4` |
| `openai-custom` | 1/1 | ✅ | 6 OpenRouter models in `configs/custom_models.json`; free IDs use `:free` suffix |

**Total: 45 models across 7 active providers.**

**Health check models (per provider):**
- `gemini-antigravity`: `gemini-3-flash`
- `gemini-cli-oauth`: `gemini-2.5-flash-lite`
- `claude-kiro-oauth`: `claude-haiku-4-5`
- `nvidia-nim`: `meta/llama-3.3-70b-instruct`
- `github-models`: `gpt-4o-mini`
- `openai-codex-oauth`: `gpt-5.4`

---

## Identity Tracking Headers
Every response from the proxy includes:
- `X-Proxy-Actual-Model` — the real model used (after any fallback)
- `X-Proxy-Actual-Provider` — the real provider used
- `X-Proxy-Fallback-Used: true` — present only when a fallback occurred

The status line reads the actual model from `/tmp/aiclient_last_model` (written by `src/utils/common.js:~390` on every request).

---

## Known Issues & Gotchas
- **Antigravity warmup**: First call after restart takes 30-50s (OAuth/project discovery). Test twice before concluding a model is broken.
- **`gemini-3.1-pro-high`**: HIGH thinking is slow (60-120s per response). This is expected. 60s model cooldown after any 400, then rotates to other accounts.
- **gemini-cli-oauth unary "empty content"**: Thinking-heavy models (`gemini-2.5-pro`, `gemini-3-flash-preview`, `gemini-3.1-pro-preview`) may return empty `content[]` in unary (non-streaming) mode when the model returns only thinking tokens. Streaming mode works correctly. This is upstream model behavior, not a proxy bug.
- **Zsh quoting**: ALWAYS use `--data-raw` for curl JSON payloads. `-d` with shell variables silently corrupts JSON.
- **Model cooldowns**: 60s for 400 errors (account-specific), 5 min for 429 (rate limits). Tracked in-memory via `_modelCooldowns` Map in pool manager; persisted to SQLite via `src/utils/db.js`.
- **`modelCooldowns` in JSON**: The `modelCooldowns` field in `provider_pools.json` is informational only — the canonical store is SQLite. If it's a string `"[object Object]"`, it's corrupted from an older code path; use the pool-reset command above to clean it.
- **Prompt caching**: Ephemeral `cache_control` headers are auto-injected on all Kiro (Anthropic) requests by `ClaudeConverter.js` — no client-side config needed.
- **OpenRouter free models**: Require `:free` suffix in the model ID (e.g., `openai/gpt-oss-20b:free`). Omitting `:free` returns 402. `custom_models.json` uses `:free` IDs with friendly aliases.
- **`claude-haiku-4-5` fallback**: If Kiro is unhealthy, falls back to `claude-sonnet-4-5` on Kiro (if available) then `gemini-claude-sonnet-4-6` on Antigravity.
- **Health check model staleness**: `DEFAULT_HEALTH_CHECK_MODELS` in `provider-pool-manager.js` and `defaultCheckModel` in `provider-utils.js` must be verified-live model IDs. When removing a model from the catalog, check both files and update the health check model too.
- **`getCustomModelConfig` colon-guard**: Only splits `provider:model` on `:` if the prefix has no `/`. This prevents `openai/gpt-oss-20b:free` being mis-parsed as provider=`openai/gpt-oss-20b`, model=`free`.

---

## Proxy Maintenance
When modifying proxy routing/credentials:
1. Edit the relevant file
2. `./scripts/safe-restart.sh`
3. Quick smoke test: `curl -sm 30 ... /v1/messages` with a fast model (e.g., `claude-haiku-4-5`)
4. Full suite: `node scripts/unified-test-suite.cjs`

When adding a new model:
1. Add to `src/providers/provider-models.js` under the correct provider key
2. Add fallback entries in `configs/config.json` → `modelFallbackMapping` if needed
3. If it's the fastest/cheapest model for a provider, consider making it the health check model in `DEFAULT_HEALTH_CHECK_MODELS` (`provider-pool-manager.js`) AND `defaultCheckModel` (`provider-utils.js`)
4. Restart and test

When removing a model:
1. Remove from `src/providers/provider-models.js`
2. Remove any `modelFallbackMapping` entries that reference it as a target
3. Update health check model if it was the health check model for that provider (check **both** `provider-pool-manager.js` and `provider-utils.js`)
4. Restart and test

When a provider needs re-auth (OAuth):
1. Run the provider's auth flow (e.g., `gemini auth login`)
2. Copy the resulting credential to `configs/<provider>/`
3. Update `configs/provider_pools.json` entry (clear `needsRefresh`, set `isHealthy: true`)
4. Restart and verify `/provider_health`

---

## Debugging Guide

**Step 1 — Always run the 3-signal triage first:**
```bash
# Signal 1: proxy alive?
lsof -nP -i :3000 -t && curl -s http://127.0.0.1:3000/api/help -o /dev/null -w "%{http_code}\n"

# Signal 2: pool health
curl -s http://127.0.0.1:3000/provider_health | python3 -c "
import sys,json; d=json.load(sys.stdin)
bad=[i for i in d['items'] if not i['isHealthy']]
print(f'{len(d[\"items\"])-len(bad)}/{len(d[\"items\"])} healthy')
[print(f'  UNHEALTHY: {i[\"provider\"]} — {str(i.get(\"lastErrorMessage\",\"\"))[:80]}') for i in bad]"

# Signal 3: model count (expect 45)
curl -s http://127.0.0.1:3000/v1/models \
  -H "Authorization: Bearer sk-a60f3efdf9b97e63c84ab4a3583f9d1c" \
  | python3 -c "import sys,json; print('models:', len(json.load(sys.stdin)['data']))"
```

**Error → Cause → Fix quick-reference:**

| Error | Cause | Fix |
|---|---|---|
| `ECONNREFUSED :3000` | Proxy not running | `npm start` or `./scripts/safe-restart.sh` |
| `Invalid JSON in request body` | zsh curl quoting | Use `--data-raw` not `-d` |
| `401` on `/v1/*` | Wrong Bearer token | Use `sk-a60f3efdf9b97e63c84ab4a3583f9d1c` |
| `no healthy provider supporting model X` | Model not in catalog OR all accounts unhealthy | Check `/provider_health`; grep model in `provider-models.js` |
| `429` quota exhausted | Rate limit | Normal — proxy rotates automatically |
| `400` on Antigravity | Per-account rejection | 60s model cooldown → other accounts rotate; auto-recovers |
| All models unhealthy after restart | `startupRun:true` caused 429 storm | Set `startupRun:false` in `config.json`, reset pool state |
| gemini-cli unary "empty content" | Thinking model returned no text in unary mode | Use streaming instead; this is upstream model behavior |
| Tool use returns text, no `tool_use` block | Converter or adapter issue | Enable `PROMPT_LOG_MODE: "file"` in `config.json`, inspect `logs/prompt_log_*.log` |

**Enable prompt logging for deep debugging:**
```bash
# In configs/config.json set: "PROMPT_LOG_MODE": "file"
# Restart, reproduce the issue, then:
ls -lt logs/prompt_log_*.log | head -5
cat logs/prompt_log_<timestamp>.log
```

---

## Applying Upstream Updates

This proxy is a customized fork of `justlovemaki/AIClient-2-API`. When upstream releases updates, apply them using this procedure to avoid losing customizations.

### Git Remote Topology
- `origin` — your personal fork (`IliaRL/AIClient2API-personal`) — push your work here
- `upstream` — public upstream repo (`justlovemaki/AIClient-2-API`) — pull updates from here
- `mine` — same as `origin` but with PAT embedded for push-protection bypass (e.g., pushing `provider_pools.json` via Contents API)

### Customization Inventory

These customizations **must survive every upstream merge**. Verify each after merging.

| File | Customization | Verification |
|---|---|---|
| `src/providers/provider-pool-manager.js:51-65` | `DEFAULT_HEALTH_CHECK_MODELS`: nvidia=`meta/llama-3.3-70b-instruct`, codex=`gpt-5.4` | `grep -n 'nvidia-nim\|openai-codex' src/providers/provider-pool-manager.js \| head -5` |
| `src/providers/provider-pool-manager.js:2505` | SQLite overlay guard: `typeof config.modelCooldowns !== 'object' \|\| Array.isArray(...)` | `grep -n 'typeof config.modelCooldowns' src/providers/provider-pool-manager.js` |
| `src/utils/provider-utils.js:55` | antigravity `defaultCheckModel: 'gemini-3-flash'` | `grep -n 'defaultCheckModel' src/utils/provider-utils.js` |
| `src/utils/provider-utils.js:99` | nvidia `defaultCheckModel: 'meta/llama-3.3-70b-instruct'` | (same grep above) |
| `src/providers/provider-models.js` | gemini-cli: 6 models (no gemma), antigravity: 5 models, github: 10 models, nvidia: 10 models | visual diff or `grep -c "'" src/providers/provider-models.js` |
| `configs/config.json` | 28 entries in `modelFallbackMapping` including `claude-haiku-4-5` | `python3 -c "import json; c=json.load(open('configs/config.json')); print(len(c['modelFallbackMapping']), 'entries,', 'haiku ok' if 'claude-haiku-4-5' in c['modelFallbackMapping'] else 'MISSING haiku')"` |

> `configs/config.json`, `configs/provider_pools.json`, and `configs/custom_models.json` are config-only files — upstream never touches them, so they never conflict.

### Merge Procedure (step by step)

```bash
# Step 1: Checkpoint — tag your current working state
git tag "pre-upstream-$(date +%Y%m%d)" HEAD

# Step 2: Fetch upstream (do NOT merge yet)
git fetch upstream

# Step 3: Review what changed in upstream since last merge
git log upstream/main --oneline | head -20
# Focus on changes to: provider-pool-manager.js, provider-models.js,
# provider-utils.js, common.js, service-manager.js

# Step 4: Preview conflicts in customized source files
git diff HEAD upstream/main -- src/

# Step 5: Merge — resolve conflicts keeping your customizations
git merge upstream/main
# If conflicts: resolve each conflict manually. For the files in the
# Customization Inventory above, always preserve YOUR version of those lines.
# git rerere is enabled and will auto-resolve previously-seen conflicts.

# Step 6: Run each verification from the Customization Inventory table above

# Step 7: Restart and run the full test suite
./scripts/safe-restart.sh
node scripts/unified-test-suite.cjs

# Step 8: Verify health (expect 30/32 — 2 gemini-cli may be on 429 cooldown)
curl -s http://127.0.0.1:3000/provider_health | python3 -c "
import sys,json; d=json.load(sys.stdin)
bad=[i for i in d['items'] if not i['isHealthy']]
print(f'{len(d[\"items\"])-len(bad)}/{len(d[\"items\"])} healthy')
[print(f'  UNHEALTHY: {i[\"provider\"]} — {str(i.get(\"lastErrorMessage\",\"\"))[:80]}') for i in bad]"

# Step 9: Tag the merged state
git tag "post-upstream-$(date +%Y%m%d)"
```

### If a Merge Breaks Something

1. Check the Customization Inventory first — most regressions are one of those 6 rows being overwritten
2. Compare against the pre-merge tag: `git diff pre-upstream-YYYYMMDD HEAD -- <file>`
3. If mid-merge and badly conflicted: `git merge --abort` (returns to pre-merge state, no data lost)
   If merge completed but proxy broken: `git reset --hard pre-upstream-YYYYMMDD` (destroys the merge commit)
4. Re-apply fixes from the Customization Inventory manually
