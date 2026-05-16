# CLAUDE.md

AIClient2API is a Node.js proxy on `http://localhost:3000` that unifies all available models from all providers (Kiro, Google Antigravity, Gemini CLI, OpenRouter, NVIDIA NIM, GitHub Models, OpenAI Codex) behind a single OpenAI/Anthropic/Gemini-compatible API.

**Ultimate Goal**: 100% uptime for all 45 models via aggressive account rotation and cross-provider fallback.

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

## Reference Docs
- [Architecture & Key Files](docs/ARCHITECT_REFERENCE.md)
- [Debugging & Triage](docs/DEBUGGING.md)
- [Maintenance & Upstream Merges](docs/MAINTENANCE.md)

## Quick Commands
```bash
./scripts/safe-restart.sh          # Safe restart
node scripts/unified-test-suite.cjs # Full test suite
./docs/DEBUGGING.md                # Check here if tests fail
```

## Implicit Learning
When debugging or implementing features, ALWAYS check `logs/prompt_log_*.log` (if enabled in `config.json`) to see the raw transformation of request/response payloads. This is the source of truth for protocol conversion bugs.
