# CLAUDE.md

Guidance for Claude Code when working in this repository. Rules here override default behavior — if a change would violate one, stop and confirm before proceeding.

For deep operational expertise, invoke `/aiclient-master` — it loads architecture, debugging, and add-provider references on demand.

---

## What This Project Is

AIClient2API is a Node.js proxy on `http://localhost:3000` that unifies client-only model surfaces behind one OpenAI/Anthropic/Gemini-compatible API.

**Active providers (as of Full-OPT v4):**

| Provider | Type | Models | Auth |
|---|---|---|---|
| `claude-kiro-oauth` | AWS Kiro OAuth | claude-sonnet-4-6, opus-4-7, haiku-4-5, + 6 more | OAuth, auto-refresh |
| `gemini-antigravity` | Google AG OAuth | gemini-3-flash, 3.1-pro-low, 2.5-flash, gemini-claude-* | OAuth, auto-refresh |
| `gemini-cli-oauth` | Google CLI OAuth | gemini-2.5-pro, 2.5-flash, 3-flash-preview, + 6 more | OAuth, auto-refresh |
| `openai-custom` | OpenRouter (static key) | 9 models via custom_models.json | Bearer key |
| `nvidia-nim` | NVIDIA NIM (static key) | 7 models | Bearer key |
| `github-models` | GitHub Models (static key) | 23 models | PAT |
| `openai-codex-oauth` | OpenAI Codex OAuth | gpt-5.2, 5.4, 5.5, codex variants | OAuth |

Entry point: `src/core/master.js`. HTTP layer: `src/services/api-server.js` + `src/services/api-manager.js`.

---

## Non-Negotiable Rules

Violating any of these breaks the user's daily workflow.

1. **Port is 3000.** Never change `SERVER_PORT`. All clients are hard-coded to it.
2. **`listModels()` is static and synchronous.** Catalog lives in `STATIC_PROVIDER_MODELS` at `src/providers/provider-models.js:24`. No live API calls, no `await` — creates a TDZ via `adapter.js → gemini-core.js → provider-models.js` circular import.
3. **No `needsReauth: true` on static-key providers.** Set at `src/providers/provider-pool-manager.js:49`: `openai-custom`, `openaiResponses-custom`, `forward-api`, `grok-web`, `nvidia-nim`, `github-models`. No refresh flow exists for these.
4. **`configs/provider_pools.json` has live tokens.** Never `git add -A`. Always diff before committing. Push via GitHub Contents API (not git push) to bypass push protection.
5. **Restart after `src/` changes.** No watcher. `kill $(lsof -t -i:3000); npm start`.
6. **`openai-custom` (OpenRouter) models come from `custom_models.json` only.** Its static list is empty `[]`. Remove entries from custom_models.json → they vanish from `/v1/models`.
7. **`startupRun: false` on health checks.** Setting it `true` fires health checks on all 25 accounts simultaneously at startup → cascade 429s poison the entire pool. Keep it `false`.

---

## Quick Commands

```bash
# Start / restart
kill $(lsof -t -i:3000) 2>/dev/null; sleep 1
npm start > /tmp/aiclient.log 2>&1 &
for i in $(seq 1 30); do curl -sf http://127.0.0.1:3000/api/help -o /dev/null && echo "ready" && break; sleep 1; done

# Health check (25 accounts expected healthy)
curl -s http://127.0.0.1:3000/provider_health | python3 -c "
import sys,json; d=json.load(sys.stdin)
bad=[i for i in d['items'] if not i['isHealthy']]
print(f'Health: {len(d[\"items\"])-len(bad)}/{len(d[\"items\"])} healthy')
[print(f'  UNHEALTHY: {i[\"provider\"]} — {str(i.get(\"lastErrorMessage\",\"\"))[:70]}') for i in bad]
"

# Model count (74 expected across 7 providers)
curl -s http://127.0.0.1:3000/v1/models \
  -H "Authorization: Bearer $(python3 -c "import json;print(json.load(open('configs/config.json'))['REQUIRED_API_KEY'])")" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); by={}; \
    [by.setdefault(m['id'].split(':')[0] if ':' in m['id'] else '?',[]).append(m['id']) for m in d['data']]; \
    print('total:', len(d['data'])); [print(f'  {k}: {len(v)}') for k,v in sorted(by.items())]"

# Test a model (use --data-raw to avoid shell quoting issues)
curl -sm 25 -X POST http://127.0.0.1:3000/v1/messages \
  -H "Authorization: Bearer sk-a60f3efdf9b97e63c84ab4a3583f9d1c" \
  -H "Content-Type: application/json" \
  --data-raw '{"model":"claude-sonnet-4-6","max_tokens":20,"messages":[{"role":"user","content":"hi"}]}'

# Enable prompt logging for deep debugging (flip back to "none" after)
# Edit configs/config.json: "PROMPT_LOG_MODE": "file" → restart → reproduce → read logs/prompt_log_*.log
```

**IMPORTANT: Always use `--data-raw` not `-d` for curl JSON payloads in zsh** — shell variable expansion inside `-d` breaks JSON silently.

---

## Architecture (where each concept lives)

| Concept | File:line | Why it matters |
|---|---|---|
| Adapter registry | `src/providers/adapter.js:704-716` | Provider not registered → `x-model-provider` header rejected, model invisible |
| Static model catalog | `src/providers/provider-models.js:24` (`STATIC_PROVIDER_MODELS`) | Authoritative list per provider; what `/v1/models` exposes |
| OpenRouter models | `configs/custom_models.json` | Only source for openai-custom models — static list is `[]` |
| Provider health check models | `src/utils/provider-utils.js:14` (`PROVIDER_MAPPINGS`) | `defaultCheckModel` per provider type — gemini-cli uses `gemini-2.5-flash-lite`, antigravity uses `gemini-3-flash` |
| Static-key set | `src/providers/provider-pool-manager.js:49` | No refresh flow for these providers |
| Pool selection + fallback | `src/providers/provider-pool-manager.js` (`selectProvider`, `markModelCooldown`) | Per-model 429 cooldown; whole-account unhealthy only on non-4xx errors |
| Provider fallback chains | `configs/config.json` → `providerFallbackChain` | Cross-provider fallback when all accounts of a type are exhausted |
| Model fallback chain | `configs/config.json` → `modelFallbackMapping` | 34-entry chain: specific model → next model → next provider |
| Cascade parsing | `src/core/config-manager.js:12` (`normalizeConfiguredProviders`) | Comma-separated `MODEL_PROVIDER` → `DEFAULT_MODEL_PROVIDERS[]` |
| Request dispatch | `src/services/api-manager.js:32` (`handleAPIRequests`) | HTTP path → endpoint type → handler |
| Provider resolution | `src/services/service-manager.js:376` (`_resolveEffectiveRouting`) | `provider:model` prefix routing, AUTO mode, pool selection |
| Model-list aggregation | `src/utils/common.js:1214-1218` | Fires when cascade > 1 OR `MODEL_PROVIDER === 'auto'` |
| Protocol conversion | `src/converters/strategies/*.js` | OpenAI ↔ Anthropic ↔ Gemini shape translation |
| Convert dispatcher | `src/convert/convert.js` | `convert-old.js` is legacy — never edit it |
| Provider implementations | `src/providers/{claude,gemini,openai,grok,forward}/*-core.js` | One `*-core.js` per backend |
| TLS sidecar | `src/utils/tls-sidecar.js`, `TLS_SIDECAR_ENABLED=true` | uTLS bypass for Cloudflare-fronted upstreams (Grok) |

---

## Configuration Files

| File | Purpose |
|---|---|
| `configs/config.json` | Port, cascade, fallback chains, health check, rate limits |
| `configs/provider_pools.json` | Live OAuth tokens + bearer keys. **Contains secrets.** |
| `configs/custom_models.json` | OpenRouter model list (9 entries — only what's needed) |
| `configs/pwd` | PBKDF2-hashed admin password. Not a usable Bearer. |
| `configs/{antigravity,gemini,kiro,codex}/` | OAuth credential files, one JSON per account |

### Key config.json values (current optimised state)

```json
"SCHEDULED_HEALTH_CHECK": { "enabled": true, "startupRun": false, "interval": 1800000 }
"REQUEST_MAX_RETRIES": 5
"RATE_LIMIT_COOLDOWN_MS": 30000
"WARMUP_TARGET": 3
```

---

## Authentication

- `/v1/*` → `Authorization: Bearer <REQUIRED_API_KEY>` (static, from config.json)
- `/api/*` management → get token via `POST /api/login` with cleartext admin password, then use returned token
- `/provider_health`, `/api/help` → public, no auth

---

## Known Issues & Fixes

| ID | Symptom | Fix location |
|---|---|---|
| A | `OpenAIConverter` dropped streamed `tool_calls` | `src/converters/strategies/OpenAIConverter.js` commit `58eb7e4` |
| B | NVIDIA NIM + GitHub Models adapters not registered | `src/providers/adapter.js:712-713` commit `a672392` |
| C | `cleanJsonSchemaProperties` stripped OpenAI tool schema fields | `src/converters/strategies/ClaudeConverter.js` commit `9537798` |
| D | `geminiToAntigravity()` deleted tools for Claude models | `src/providers/gemini/antigravity-core.js` commit `083a7cf` |
| G | `/v1/models` only aggregated in `auto` mode | `src/utils/common.js:1214-1218` commit `083a7cf` |
| H | Startup health checks causing cascade 429s | `configs/config.json startupRun=false, interval=1800000` |
| I | `gemini-cli-oauth` check model `gemini-2.5-flash` exhausting quota | `src/utils/provider-utils.js` → `defaultCheckModel: 'gemini-2.5-flash-lite'` |

---

## Gotchas

- **Antigravity first call: 30-50s.** OAuth bootstrap + Project ID discovery. Warm calls ~1s. Always test twice before patching.
- **`gemini-3.1-pro-high` returns 400.** Google backend bug — not a proxy issue. Falls back to `gemini-3.1-pro-low` via modelFallbackMapping. claude-pick #3 points to `gemini-3.1-pro-low` directly.
- **`gemini-2.5-flash` / `gemini-3.1-pro-low` intermittent timeouts.** Google capacity issues. The proxy handles via fallback — don't patch the proxy for these.
- **Gemini CLI 403 "API not enabled in project X".** GCP project activation issue, not a code bug. Fix: visit the console URL in the error → enable Staging CloudCode API.
- **Shell quoting in zsh: use `--data-raw` for curl JSON.** `-d` with embedded quotes causes "Invalid JSON" errors that look like proxy bugs.
- **`convert-old.js` is legacy.** Edit `src/converters/strategies/` and `src/convert/convert.js` only.
- **Image generation loop is intentionally sequential** (`api-manager.js:224`). Each image ties to a pool slot — parallelising would break slot accounting.
- **Git: personal backup repo** is `https://github.com/IliaRL/AIClient2API-personal` (private). Push via `git push mine`. PAT stored in `git remote get-url mine`. `provider_pools.json` pushed via GitHub Contents API to bypass push protection.

---

## Verification Checklist (run after every change)

```bash
# 1. Restart
kill $(lsof -t -i:3000) 2>/dev/null; sleep 1
npm start > /tmp/aiclient.log 2>&1 &
for i in $(seq 1 30); do curl -sf http://127.0.0.1:3000/api/help -o /dev/null && echo "ready" && break; sleep 1; done

# 2. Health: expect 25/25 healthy
curl -s http://127.0.0.1:3000/provider_health | python3 -c "
import sys,json; d=json.load(sys.stdin)
bad=[i for i in d['items'] if not i['isHealthy']]
print(f'{len(d[\"items\"])-len(bad)}/{len(d[\"items\"])} healthy')
[print(f'  UNHEALTHY: {i[\"provider\"]} {str(i.get(\"lastErrorMessage\",\"\"))[:60]}') for i in bad]
"

# 3. Models: expect 74 across 7 providers
curl -s http://127.0.0.1:3000/v1/models \
  -H "Authorization: Bearer sk-a60f3efdf9b97e63c84ab4a3583f9d1c" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('models:', len(d['data']))"

# 4. Quick smoke test per provider tier
for model in "claude-sonnet-4-6" "gemini-3-flash" "gemini-claude-sonnet-4-6" "qwen/qwen3-coder-next" "nvidia/llama-3.1-nemotron-ultra-253b" "gpt-4o"; do
  r=$(curl -sm 25 -X POST http://127.0.0.1:3000/v1/messages \
    -H "Authorization: Bearer sk-a60f3efdf9b97e63c84ab4a3583f9d1c" \
    -H "Content-Type: application/json" \
    --data-raw "{\"model\":\"$model\",\"max_tokens\":10,\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}]}" 2>/dev/null)
  ok=$(echo "$r" | python3 -c "import sys,json; d=json.load(sys.stdin); print('OK' if d.get('content') else 'FAIL')" 2>/dev/null)
  printf "%-45s %s\n" "$model" "$ok"
done
```

State exact numbers. Never claim "should work."

---

## Where to Get More Detail

- `/aiclient-master` skill — deep architecture, debugging matrix, add-provider checklist
- `logs/app.log` — runtime logs; `tail -f` while reproducing
- `configs/config.json` → `modelFallbackMapping` — the full 34-step fallback chain
- Memory: `~/.claude/projects/-Users-ilialiston-AIClient2API/memory/MEMORY.md`
