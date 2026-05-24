# CLAUDE.md

AIClient2API is a Node.js proxy on `http://localhost:3000` that unifies all available models from all providers (Kiro, Google Antigravity, Gemini CLI, OpenRouter, NVIDIA NIM, GitHub Models, OpenAI Codex) behind a single OpenAI/Anthropic/Gemini-compatible API.

**Ultimate Goal**: To provide a high-performance, 100% compatible proxy system that allows any AI model to be used within the Claude Code CLI with zero friction. Every accessible model must be fully functional, including complex tool-use and schema handling.

**Exhaustive Fallback Strategy:**
1. **Vertical Rotation**: Exhaust every account for the *selected model* on the *current provider*.
2. **Horizontal Rotation**: Exhaust every account for the *selected model* across *all other providers*.
3. **Tiered Fallback**: Only after the selected model is 100% exhausted across all accounts and providers does the system fall back to the next most powerful model in the tier (e.g., Sonnet -> Opus -> Gemini Pro).
*Note: Selection priority is always respected; fallbacks are silent and intended to maintain availability of the requested capability.*

**Success Criteria:**
- **Compatibility**: 100% pass rate for Claude Code tools (Agent, Bash, Grep) across all 45 models.
- **Robustness**: Automated recovery from 429/400/500 errors via the Exhaustive Rotation logic.
- **Visibility**: Real-time status signals (model/context/tokens) provided via the IDE status line.
- **Efficiency**: Minimal latency overhead through optimized protocol conversion and SQLite state persistence.

## What This Proxy Is

AIClient2API is an **account-rotation load-balancer** — a stateful proxy that manages credentials across 32 accounts (13 Antigravity + 6 Gemini CLI + others) to maximize throughput and availability. It translates OpenAI, Anthropic, and Gemini request/response formats on the fly.

## Cockpit Quota Tracking & Load-Balancing

**Goal:** Implement a resilient, non-blocking Quota Tracking and Load-Balancing module that dynamically routes requests to the accounts with the most remaining quota, while keeping Cockpit OAuth sessions alive.

**Core Integration Point:**
`http://127.0.0.1:18081/report?token=C-Code-CLI-Model-API`

This endpoint returns a plain-text Markdown table of accounts, models, and remaining quota percentages. Poll it on a sub-10-minute interval to both keep OAuth sessions alive and refresh the in-memory quota cache without blocking the main proxy thread.

**Objectives:**
1. **Session Keep-Alive:** Poll the Cockpit endpoint frequently enough (< 10 min) to prevent OAuth session expiration.
2. **Quota Ingestion:** Parse the Markdown table response and store quota data in memory for instant synchronous lookup.
3. **Smart Routing:** Expose a penalty scoring function to the load balancer — accounts/models near quota exhaustion receive heavy penalties; high-quota accounts are prioritized.
4. **Filesystem Fallback:** If the Cockpit endpoint is unavailable, seamlessly fall back to reading `~/.antigravity_cockpit/accounts.json` and the individual account files under `~/.antigravity_cockpit/accounts/` to derive offline quota state.

## Non-Negotiable Rules
1. **Port is 3000.** Never change `SERVER_PORT`.
2. **`listModels()` is static & synchronous.** `src/providers/provider-models.js` MUST NOT use `await` or live API calls.
3. **No `needsReauth: true` on static-key providers** (OpenRouter, NIM, GitHub, Codex).
4. **Secrets safety.** `configs/provider_pools.json` contains live tokens. NEVER `git add -A`.
5. **Restart via `./scripts/safe-restart.sh` only.** Kills only the port-3000 listener.
6. **OpenRouter (`openai-custom`) models** come ONLY from `configs/custom_models.json`.
7. **Keep `startupRun: false`** in `configs/config.json` to prevent startup 429 storms.
8. **Model IDs must be versioned.** Use `claude-sonnet-4-5-20250929`, not shorthand like `claude-sonnet-4-6`.
9. **Health check models must be live.** `DEFAULT_HEALTH_CHECK_MODELS` and `defaultCheckModel` must reference verified-live IDs.
10. **`modelCooldowns` must be objects.** Clean if they become `"[object Object]"`.

## AI Behavior Guidance

Before acting on any request:

1. **Verify the execution path is necessary.** Don't restart the proxy unless `/provider_health` shows accounts failing or tests are broken. Don't add a fallback chain entry without first grepping `modelFallbackMapping` in `configs/config.json`.

2. **Check if the request is already applied.** Before modifying a config, read it first. Before adding a new model ID, search `src/providers/provider-models.js`. Duplicate entries silently shadow each other.

3. **Reason before modifying core files.** Upstream merges must be checked against the Customization Inventory in `docs/MAINTENANCE.md` before applying — upstream may revert critical fixes. `provider-models.js` must stay synchronous (Rule 2) — confirm any change doesn't introduce `await` through transitive imports.

4. **Prefer investigation over assumption.** If a model returns an error: check `/provider_health` first. If all accounts appear healthy, enable `PROMPT_LOG_MODE: "file"` in `configs/config.json`, restart, reproduce, then read `logs/prompt_log_*.log` to see the exact request/response transformation. This is the fastest path to the root cause.

## Session Protocol & Handoff Rules

Create a handoff in `docs/handoffs/YYYY-MM-DD-handoff.md` **only when**:
- A non-obvious root cause was discovered (not "proxy is working", but "modelCooldowns corruption caused by X")
- A change spans >2 core files or modifies the converter/fallback system
- The user explicitly requests a handoff

**Handoff format** (4 fields, no prose):
```
**Goal:** [What was requested]
**Finding:** [Root cause or non-obvious discovery]
**Fix:** [What changed and why — file:line]
**Next Step:** [What should happen next, or "complete"]
```

Do NOT create handoffs for routine fixes, configuration tweaks, or single-file changes.

## Commit & Code Safety Rules

1. **Only commit when explicitly asked.** Do not create commits after completing a task unless instructed.
2. **Always specify files, never `git add -A` or `git add .`** — `configs/provider_pools.json` contains live OAuth tokens and must never be accidentally staged.
3. **`provider_pools.json` is live credential state, not code.** Only commit it if explicitly instructed; always use the GitHub Contents API to push it (bypasses push protection).
4. **Before committing provider logic changes:** confirm `/provider_health` shows ≥25 healthy accounts. A broken commit here takes the proxy offline.

## Reference Docs
- [Architecture & Key Files](docs/ARCHITECT_REFERENCE.md)
- [Debugging & Triage](docs/DEBUGGING.md)
- [Maintenance & Upstream Merges](docs/MAINTENANCE.md)

## Documentation Routing

Use the right reference for the task:

| You need to... | Read first | Then check |
|---|---|---|
| Add a provider or model | `docs/ARCHITECT_REFERENCE.md` | `src/providers/adapter.js`, `provider-models.js` |
| Diagnose a failed request | `docs/DEBUGGING.md` (3-signal triage) | `/provider_health` output |
| Fix a 429 or cooldown issue | `docs/DEBUGGING.md` (error table) | `provider-pool-manager.js` |
| Apply an upstream merge | `docs/MAINTENANCE.md` (Customization Inventory) | Verify each row after merge |
| Debug a tool-use or protocol bug | `docs/ARCHITECT_REFERENCE.md` | `logs/prompt_log_*.log` |

**CLAUDE.md is intentionally minimal.** Architecture details, error tables, and step-by-step procedures live in `docs/` — this file contains only rules and navigation guidance.

## Quick Commands
```bash
./scripts/safe-restart.sh          # Safe restart
node scripts/unified-test-suite.cjs # Full test suite
./docs/DEBUGGING.md                # Check here if tests fail
```

## Implicit Learning & Debugging

Always check `logs/prompt_log_*.log` (enable with `PROMPT_LOG_MODE: "file"` in `configs/config.json`) to see raw request/response transformations. This is the source of truth for protocol conversion bugs.

**State lives in two places:** The in-memory pool (source of truth at runtime) and SQLite (`src/utils/db.js`, persists across restarts). If state appears corrupted, compare both. SQLite state is overlaid onto the pool at startup — a corrupted SQLite row will override a healthy in-memory state on the next restart.

For full triage procedure and error lookup tables, see `docs/DEBUGGING.md`.
