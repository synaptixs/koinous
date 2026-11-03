# Koinous — shared inquiry

> **Current product direction (2026-11-01):** discuss an idea with two or three model participants using subscription login, exchange critiques, and produce one recommendation with explicit agreement and unresolved dissent. An idea alone is sufficient; optional context is supported. The active roadmap is W1–W6 in docs/IMPLEMENTATION_PLAN.md. Enterprise hardening and PKG are deferred. Earlier P0–P6 and PKG sections below are historical/optional engineering work, not prerequisites.
>
> **Current safety state:** `KOINOUS_ENABLE_INFERENCE=0` blocks real API discussion starts; `GROK_BUILD_ENABLE_INFERENCE=0` remains unchanged. Mock mode still works. The revised final-position workflow is offline-tested; live validation is pending separate authorization.

**Koinous** is a coined project name evoking shared thought: independent perspectives working toward understanding while preserving dissent. The POC lives in `collaborator/`. This is a working name, not a claim of trademark or domain availability.

Available providers: **OpenAI (Codex), Anthropic (Claude), and xAI (Grok Build)**. Choose two or three participants; OpenAI and Claude each support two different models under one provider login; subscription login is the application authentication path, with no API-key fallback. Gemini follows after these adapters are validated; Ollama is a possible later local-model backend. Existing agent IDs (`codex`, `claude`, `grok`) and environment variables remain stable.

A local-first, read-only, three-round discussion orchestrator with a live browser transcript, user interventions, optional evidence, and audit files. It supports **mock** (no dependencies or credentials) and **real** provider modes.

> **Status:** The mock-mode end-to-end workflow and unit tests have been executed successfully. Live connectivity smoke tests have run: OpenAI and Anthropic returned the expected marker; Grok initially declined the exact-marker instruction, then passed the revised low-reasoning semantic test with the answer `4.` in one request. A bounded live three-provider discussion subsequently passed all nine responses across three rounds; peer routing, usage reconciliation, and saved report checks passed. MCP remains untested. This is a POC, **not** a production security boundary.

## OpenAI-only corporate demo

If your team uses only corporate ChatGPT/Codex access, run:

```sh
npm run demo:live -- --openai-only
```

This installs pinned dependencies and reuses your local ChatGPT login or opens
Codex's browser login flow when needed. Sign in with your approved corporate
account. It checks only Codex; Claude and Grok are disabled, with no API-key
fallback. An existing login is reused, so confirm it is the intended corporate
account before starting. Koinous does not select an enterprise workspace for you.

In the UI, enter **two different model IDs** available through that account,
one for each OpenAI participant. Keep three rounds for six responses: initial
analysis, peer review, and revised recommendations. Each participant has a separate
conversation, peer identity, selected model and accounting. Both use the same
local subscription login. Start discussion sends prompts; setup sends none.
Stop with Ctrl+C when finished.

Your organization must allow Codex and both requested models. Login status is
not an entitlement or quota check. No model list is invented or automatically
probed, and a rejected model stops the discussion without fallback or retries.
Different requested IDs can be aliases; Koinous cannot prove distinct underlying
models when the provider does not report their resolved identities. Two models
from one provider are not independent evidence of correctness. Subscription USD
costs remain unknown when the SDK supplies no cost.

This path is verified offline and in the mock UI. Corporate authentication and
live two-OpenAI-model inference have not been tested. The earlier live acceptance
covers Codex plus Claude, not this new combination.

## Idea discussion workflow

1. Enter an idea, optional context, and choose two or three model participants (including two different OpenAI models).
2. Optionally choose **Wikipedia background sources** and enter public topic keywords.
   Only these keywords are sent to the fixed Wikipedia endpoint; the private idea and
   context are not used as the search query. Retrieval is one request, ten seconds,
   128 KiB maximum, and up to five article introductions. Failure stops before provider
   preparation/inference. No API key, retries or model tools are added.
3. Run three rounds: independent evidence/assumption analysis, structured peer review,
   and revised final positions. Each provider identifies which peer arguments it
   adopts, rejects or leaves unresolved. This is one bounded revision cycle (six or
   nine calls); shorter runs remain exploratory.
4. Review the single attributed recommendation, rationale, risks, next actions,
   research sources, peer/revision coverage, unsupported claims and disagreements.
   The report preserves source excerpts and unknown subscription costs. Saved sessions
   reopen all this information without inference. Missing review coverage prevents
   an engine result from being labelled agreement.

The discussion prompts ask for the strongest credible alternative and the evidence or
condition that would make it preferable. Peer review focuses on material changes to
the decision or its test; a participant can explicitly retain its view when a critique
adds no material change. Final positions keep the comparison in the rationale and
remain self-contained. These are drafting instructions, not semantic guarantees or
automatic duplicate detection; all original responses and dissent remain available.

This iteration uses a provisional external model review of an incomplete development
sample as product feedback. It does not establish improved quality or complete P6's
human-review gate. New prompts also reach standalone evaluation baselines through
`composePrompt`; future comparisons require a fresh versioned protocol and separately
authorized matched attempt. Historical results must not be pooled with new outputs.

### Decision brief

Each validated participant has an attributed decision brief: chosen action, strongest
credible alternative, decisive tradeoff, switch condition and declared response to
peer review. The UI and Markdown report show these fields without another model call
or inferred synthesis. Similar answers remain separately attributed; declared changes
are not independently verified improvements. Coverage, dissent, unsupported claims
and unchanged original responses remain available.

New final positions request `comparison: {alternative, tradeoff, switchCondition}`.
`alternative` is text, or `null` when the participant declares no feasible alternative;
then `tradeoff` explains why and `switchCondition` states what would reopen the decision.
The object is optional for backward compatibility: omission means **Not recorded**,
not that no alternative exists. Each string is nonempty and targets 400 UTF-16 units;
prose overruns warn without clipping. Unknown/missing fields, wrong types and the
existing 12,000-unit total response cap remain blocking. Different comparisons prevent
new assessments from claiming agreement, even when recommendation wording matches.

Saved assessments retain their original comparison fields and recorded status. Older
sessions are not reassessed or backfilled; reopening and exporting create no model
calls and do not rewrite stored files. The original-report download remains byte-exact.
These fields extend the final-position contract; any future evaluation requires a
fresh versioned protocol and authorization, as described above.

Downloaded Markdown reports use numbered actions, provider reasoning, disagreements,
claim checks and readable peer-review/revision sections. Original responses remain
verbatim in fenced blocks. Reopened sessions use their recorded assessment; older
sessions without one stay unassessed. Saved downloads include the original report
as an audit appendix for historical evidence. Append `?format=original` to the report
URL to retrieve the exact stored artifact. Downloads never run providers or rewrite
saved reports.

Research is deliberately labelled **background only**, not comprehensive web research,
current-news research or primary-source verification. The adapter uses the documented
[MediaWiki search generator](https://www.mediawiki.org/wiki/API:Search) and
[plain-text introductions](https://www.mediawiki.org/wiki/Extension:TextExtracts#API).
Providers must name gaps and contrary evidence; a shared source or matching answer
is not independent corroboration. Review coverage validates declared participation,
not the semantic quality of the critique. Earlier saved runs without declarations
show unassessed coverage. No hidden fourth-model synthesis call is made.

## Prerequisites

- Node.js **22.10+** (tested with Node 22.16). Node's experimental TypeScript type stripping is used to keep mock mode dependency-free.
- For real mode: existing ChatGPT login for Codex, Claude subscription login, and (when selected) Grok Build browser login with the isolated VM runtime configured. API keys are not required or passed by the application adapters.

## Quick start: runnable mock demo

For the credential-free team walkthrough and clean GitHub handoff, see [DEMO.md](DEMO.md).

```bash
git clone https://github.com/synaptixs/koinous.git
cd koinous
npm run demo
```

Open **http://127.0.0.1:3030**. Enter a question; choose up to 3 rounds; press **Start discussion**. The text is explicitly mock-generated, not AI model output.

The discussion runs the configured two or three independent providers in Round 1; gives each its peers' first-round findings in Round 2; and uses the critiques for collaborative resolution in Round 3. Markdown and JSONL files are created under `runs/<session-id>/`.

## Real providers

Install the exact dependency graph from the lockfile:

```bash
npm ci
npm run check
```

Pinned packages: `@openai/codex-sdk@0.166.0`, `@anthropic-ai/claude-agent-sdk@0.3.316`, and `@modelcontextprotocol/sdk@1.32.2`. Grok Build uses the pinned CLI and isolated VM wrapper described below. `npm run check` typechecks source and tests and runs offline Node/Python regressions; it makes no model calls.

### Subscription authentication and provider selection

For personal browser sign-in and explicit real-discussion startup, follow
[Use your own subscriptions](DEMO.md#use-your-own-subscriptions-for-real-discussions).
Start with `npm ci` and `npm run setup`. Setup never enables model inference.

`KOINOUS_PROVIDERS` sets the initial UI selection and the default roster when a request omits selection: `codex,claude`, `codex,grok`, `claude,grok`, or all three (the default). Ordering is preserved. Fewer than two, duplicate, empty, or unsupported IDs fail before dispatch. Each session gets fresh adapters. The call cap is the selected count × requested rounds: at most six calls for a pair or nine for three providers.

```bash
# Configuration example only; starting real discussions consumes subscription usage.
export KOINOUS_PROVIDERS="codex,claude"
export CODEX_MODEL=""        # optional; SDK default
export CLAUDE_MODEL=""       # optional; SDK default
export MODEL_TIMEOUT_MS="120000"
export MAX_SESSION_USD="3"   # advisory known-accounting threshold
export MODE=real
npm start
```

Codex receives `forced_login_method=chatgpt` and `model_provider=openai`. Claude receives `forceLoginMethod=claudeai` and no inherited user/project settings. Both SDK subprocesses receive only an allowlist of OS essentials and login-directory variables, excluding API keys, bearer tokens, custom endpoint/cloud-provider routing, and injected Node options. Local login stores remain available; no credentials are copied or printed. These settings select the subscription authentication path; offline tests do not establish current entitlement, remaining quota, or invoice treatment. Organization-managed policies remain authoritative.

For a roster containing `grok`, the application defaults to `GROK_TRANSPORT=build` and rejects `api` or unknown transports. Configure `GROK_BUILD_RUNTIME=vm`, the pinned guest binary, dedicated VM, auth source, and read-only workspace using the isolated-runtime instructions below. Inference also requires `GROK_BUILD_ENABLE_INFERENCE=1` for an explicitly authorized run. The adapter never provisions a VM or falls back to an API key. The historical direct-API adapter and smoke script remain for reproducibility; the application factory does not select them. Do not run historical API smoke commands for subscription validation.

A local `.env` remains ignored; `npm start` loads it when present. The credential-free demo command in DEMO.md bypasses it. If using `node --env-file=.env --experimental-strip-types src/server.ts`, remove any stale `GROK_TRANSPORT=api` configuration first. Unselected providers require no credentials or runtime. Model selection remains independent of roster selection through `CODEX_MODEL`, `CLAUDE_MODEL`, and `GROK_BUILD_MODEL`. Gemini and Ollama are not yet supported IDs.

**Accounting:** `MAX_SESSION_USD` is an advisory threshold on known provider accounting values, not a subscription invoice or a hard billing ceiling. Parallel calls and unknown costs prevent a complete monetary cap. No API pricing is applied to subscription token counts. The call cap counts adapter invocations, not internal SDK inference attempts/retries.

**Sandboxing:** Codex remains read-only with approvals, network access, and web search disabled. Claude retains no tools and `dontAsk` permissions. Grok retains its isolated-VM and read-only sandbox protections. These remain POC controls, not proof of production isolation.

### Grok protocol timing diagnostics

Grok replies and provider-error events include `protocolTiming` when the ACP client
has started. This versioned trace contains at most four fixed stages: `startup`
(waiting for initialize and its validation), `authentication`, `session-creation`,
and `inference` (waiting for the prompt's terminal result). Each row has monotonic
`startedMs`, `durationMs` and `completed`; `elapsedMs` and `lastStage` summarize the
snapshot. Inference timing includes the whole streamed turn, not just first-token
latency. Startup starts when the client attaches to the launched process; VM
provisioning, pre-launch configuration checks and teardown are outside this scope.

Only stage enums, bounded millisecond values and completion flags are captured:
no prompts, responses, thoughts, credentials, IDs, hostnames or stderr. Immutable
snapshots survive the outer engine deadline through synchronous abort propagation
and are persisted in events, including saved-session error history. Original text,
usage and validation rules are unchanged. A pending stage localizes the client's
wait; it does not establish whether the underlying cause is networking, entitlement
or provider latency. Completed stages do not certify successful cleanup. Older
records without timing remain unknown; no retrospective timing is invented.

## Timeouts and usage accounting

Final reports show successful replies out of the configured roster's planned round slots, a per-provider round matrix, and recorded provider failures, budget denials, and session stop reasons. A provider exception or timeout stops a new discussion: in-flight peers are signalled to abort, no later round is admitted, and the session is partial unless user cancellation or cleanup failure takes precedence. Completed replies and their usage remain intact. Schema-invalid replies remain recorded and excluded from structured coverage; they do not trigger this transport-failure policy. Older completed sessions can have incomplete participation; excluded providers are not counted as agreement. Older runs use their recorded first-round roster when available and otherwise report coverage as unknown.

The application uses subscription login for Codex, Claude, and Grok Build. Earlier direct xAI API experiments are historical evidence only; API cost valuations and SDK estimates are not subscription invoices or deductions.

`MODEL_TIMEOUT_MS` defaults to 120000 ms per invocation, including SDK startup. Positive integer overrides `CODEX_TIMEOUT_MS`, `CLAUDE_TIMEOUT_MS`, and `GROK_TIMEOUT_MS` apply per provider. Invalid timeout configuration fails the session before dispatch. Cancellation propagates to all active calls; a deadline first aborts its own call, then the engine aborts remaining peers and stops the discussion. The orchestrator stops waiting even if a provider ignores abort, and late answers cannot mutate the session. Aborting does not guarantee that the provider stops billing or that an uncooperative worker has exited.

The orchestrator performs no automatic retries. The roster-derived call cap counts adapter invocations, not internal SDK inference attempts or retries. SDK subprocesses still need host isolation before sensitive use.

Each completion/error event records `durationMs`, available `usage`, and available model/response/session identifiers. `requestedModel` is distinct from the model reported by the provider; SDK defaults may leave it absent. A Claude result UUID is a result identifier, not a billing request ID. The session API, final SSE event, and Markdown report expose a usage summary: for each metric, `known` is the observed total and `missingCalls` counts completed/failed invocations without that metric. An in-flight call is not included until it settles.

- `inputTokens` includes cache reads/writes. For Claude, these are added to uncached input from the SDK's per-model query totals. Codex and Grok already report total input.
- `outputTokens` includes reasoning where the provider includes it. `reasoningTokens`, `cacheReadTokens`, and `cacheWriteTokens` are breakdowns; do not add them again to input/output totals. Missing breakdowns remain unknown.
- Claude uses final `modelUsage` across the query pipeline, including auxiliary calls covered by the SDK, and `total_cost_usd` as a provider estimate. Available usage on error results is retained.
- Grok Build accounting comes from ACP `_meta.usage`, including `costUsdTicks` when a complete valid amount is supplied (10,000,000,000 ticks per USD). Partial, absent, or placeholder-zero cost stays unknown. Historical direct API records used `cost_in_usd_ticks`. No pricing table is inferred.
- Codex SDK 0.166.0 exposes exactly five usage counters: `input_tokens`, `cached_input_tokens`, `cache_write_input_tokens`, `output_tokens`, and `reasoning_output_tokens`. These are normalized and retained, including on empty-answer failures. It exposes no USD cost field. `usd` stays `null`, undocumented cost-shaped fields are ignored, and the final report explicitly names Codex cost as unknown. Per-provider tables show known USD and calls missing cost; zero known subtotal with missing calls is not zero actual cost.

Timeouts and transport failures with no final usage mark spending incomplete. Partial/error responses never become successful peer answers. Provider HTTP error bodies and arbitrary SDK exception messages are excluded from events to avoid logging echoed secrets. No hidden reasoning text is retained by the Grok response parser.

References: [OpenAI Codex SDK](https://learn.chatgpt.com/docs/codex-sdk), [Claude Agent SDK types](https://code.claude.com/docs/en/agent-sdk/typescript), [xAI Responses](https://docs.x.ai/developers/rest-api-reference/inference/responses), [xAI cost units](https://docs.x.ai/developers/cost-tracking). Installed SDK declarations are checked by the TypeScript gate. These checks do not establish live service compatibility.

## Grok Build subscription adapter (inference requires explicit opt-in)

`GROK_TRANSPORT=build` is now the application default and only supported real-mode transport. Participant ID remains `grok`. Build requires `GROK_BUILD_ENABLE_INFERENCE=1` explicitly for authorized model runs; this task did not enable it.

The local Build 1.0.70 macOS arm64 binary is pinned by SHA-256 in `src/grok-build.ts`. Its official artifact is `https://x.ai/cli/grok-1.0.70-macos-aarch64.gz`. The installed task copy is `runs/toolchain/grok-1.0.70`; the dedicated browser-login profile is `runs/grok-build-home`. Both are ignored by Git. Do not share the profile: it contains credentials. Browser login succeeded, and an authenticated, non-inference model-list request returned `grok-4.7`, `grok-4.7-build-fast`, `grok-4.6`, and `grok-4.5`. This establishes login/catalog access, not successful inference or a guarantee of future included usage.

The adapter uses ACP `cached_token` authentication only, with no API-key fallback. Each call uses a fresh temporary profile/workspace, copies only the browser credential file, disables inherited Claude/Cursor discovery, web search, memory and subagents, denies tools/client filesystem/terminal requests, selects low reasoning and one turn, and kills the process on completion/cancellation/deadline. The configured completion allowance is 1,200; Build's enforcement and token semantics remain unverified. Transport output is bounded to 2 MiB. A fresh session is created for each round; the orchestrator supplies prior positions and peer text.

The documented ACP messages do not establish a reliable accounting schema for this pinned build. Token and USD usage therefore remain **unknown**, rather than fabricated as zero. This is a limitation relative to the direct API adapter. Raw thoughts, provider error bodies and stderr are not saved in discussion reports. Read-only SDK/CLI settings still do not constitute complete host isolation.

Authentication-only preflight (no `session/new` or `session/prompt`):

```bash
GROK_BUILD_BINARY="$PWD/runs/toolchain/grok-1.0.70" \
GROK_BUILD_AUTH_HOME="$PWD/runs/grok-build-home" \
node --experimental-strip-types scripts/grok-build-preflight.ts
```

**Current host blocker:** the preflight exits before ACP initialization because Build's read-only sandbox rejects `/var/run/docker.sock`, a symlink through Podman to a socket outside its runtime deny list. The adapter retains the read-only sandbox and fails closed. The system socket link and sandbox protections were not changed. Resolve this with a supported sandbox configuration or compatible pinned Build release before enabling inference. A future model test requires new authorization.

Follow-up on 2026-11-01: the same failure was reproduced with official alpha 1.0.73 and with a custom profile extending read-only and explicitly denying the canonical Podman socket. Neither resolves automatic runtime-socket validation. The adapter remains pinned to stable 1.0.70; no fallback, relaxed network restriction, host socket change, or model request was used. Preflight now emits sanitized `sandbox_incompatible` diagnostics. The saved authentication-only result is `runs/grok-build-sandbox-preflight-2026-11-01.json`. The native runtime still needs a supported upstream repair; the separately isolated VM path is described below.

Isolated-runtime follow-up on 2026-11-01: official Linux aarch64 Build 1.0.70 successfully completed ACP `initialize` inside a dedicated AppleHV VM, with Grok's read-only sandbox unchanged. An outer unprivileged bubblewrap namespace makes the VM root read-only and hides runtime sockets; only the dedicated profile is writable. The host home is not shared, and the binary staging share is read-only. Checks confirmed hidden sockets, absent host home, and denied workspace writes. Default restricted containers could not launch the nested sandbox; their protections were not relaxed.

Authentication **passed** after explicit approval to temporarily transfer the cached browser credential into the dedicated VM. The bounded runner sent only `initialize` and `authenticate` (`grok.com`, headless); no inference session or model prompt was sent. With the credential present, Build advertised both `cached_token` and `grok.com` (only `grok.com` appeared before provisioning). All isolation checks passed again. The guest credential was deleted and its absence verified after the test; the disposable VM was then stopped and removed. This isolated runtime is an investigation harness, not a completed production transport; the native macOS blocker remains. Evidence and the bounded runner are saved in `runs/grok-build-isolated-runtime-2026-11-01/`, including `authentication.json`. Authentication acceptance does not establish model entitlement or inference compatibility.

Offline tests cover cached-token-only authentication, no-prompt preflight, public-text filtering, disabled tool requests, incomplete/empty replies, sanitized errors, cancellation, process exit, output limits, missing binary and transport selection. These tests do not prove actual model-call compatibility.

Sources: [Build scripting/ACP](https://docs.x.ai/build/cli/headless-scripting), [CLI reference](https://docs.x.ai/build/cli/reference), [sandbox profiles](https://docs.x.ai/build/features/sandbox), [shared subscription usage](https://docs.x.ai/grok/faq). Local investigation evidence: `runs/grok-build-investigation-2026-11-01.json`.

## Isolated Grok Build adapter runtime

`GROK_BUILD_RUNTIME=vm` routes the existing Build adapter and authentication-only preflight through a **separately provisioned, dedicated local AppleHV VM**. The adapter does not start, stop, or reconfigure user VMs. Native remains the default; unknown runtime values fail without fallback. `GROK_TRANSPORT=build` still selects Build for discussions, and inference still requires explicit `GROK_BUILD_ENABLE_INFERENCE=1`.

Provision a fresh nonroot `koinous-grok-*` VM using Podman (investigation used 5.8.3), Python 3, util-linux `findmnt`, bubblewrap (investigation used 0.12.0), and working unprivileged nested user namespaces. Share **only a dedicated tool staging directory**, read-only, at canonical `/var/mnt/koinous`. Do not use a shared development VM or mount the host home or checkout. Place official Linux aarch64 Grok Build 1.0.70 there as `grok`; the guest bridge verifies SHA-256 `3aa36883574b263088e5addffe241f55430e8daaee1a0c4934b02180007a9761` before launch. The artifact source is `https://x.ai/cli/grok-1.0.70-linux-aarch64.gz`. Runtime provisioning/downloads are explicit operator steps, not automatic adapter side effects.

Configuration for a future authorized authentication-only preflight (replace the Podman path with its actual absolute installed path):

```bash
GROK_BUILD_RUNTIME=vm \
GROK_BUILD_PODMAN=/absolute/path/to/podman \
GROK_BUILD_VM=koinous-grok-auth \
GROK_BUILD_AUTH_HOME="$PWD/runs/grok-build-home" \
node --experimental-strip-types scripts/grok-build-preflight.ts
```

The selected VM is a trusted credential destination. The adapter sends only `auth.json` through SSH stdin; credentials never appear in command arguments, the staging share, or adapter logs. A fresh mode-0700 profile on guest `/dev/shm` contains a mode-0600 credential. User configuration/plugins are not copied. The source credential remains untouched. Each invocation gets a separate profile and process.

The guest rejects root execution, a visible `/Users`, unexpected virtiofs shares, a writable staging mount, and a mismatched binary. Outer bubblewrap uses user/PID/IPC/UTS namespaces, a read-only guest root/workspace, temporary scratch space, hidden runtime sockets and guest homes, and only the invocation profile mounted writable. Grok retains its own `--sandbox read-only`, no tools, denied permissions, no subagents and no leader. Main-process authentication networking remains available, as in the earlier isolated preflight; this is not a network air gap. No privileged-container, capability, or seccomp relaxation is used.

On completion, cancellation, protocol error or EOF, the parent closes stdin and waits up to five seconds for successful guest teardown. The guest kills the process group and deletes the entire temporary profile in `finally`, including on launch/deadline failures. A separate watchdog interrupts a disconnected or stalled transport after 130 seconds, followed by process termination and profile cleanup; this is not a claim that cleanup is immediate. A missing/nonzero teardown exit is reported as `cleanup_unverified`, never success. Abrupt guest/host failure can prevent confirmation; tmpfs credentials do not survive VM shutdown. Shut down the dedicated VM if cleanup cannot be confirmed.

Offline validation uses synthetic credentials and fake ACP/processes, including real temporary-file cleanup checks. `npm run check` now runs TypeScript checking, Node tests, and Python guest tests (`python3` required). **No model or authentication requests were run for this implementation.** The integrated wrapper passed authentication-only verification on 2026-11-01: all nine mount/isolation checks passed, no temporary credential profiles or Grok processes remained, and the disposable VM was removed. One authentication run and zero model requests were made. Evidence: `runs/grok-build-integrated-preflight-2026-11-01/verification.json`. Model entitlement and inference compatibility remain untested. Podman initially mounted the staging share writable despite `:ro`; the adapter rejected that state before real credential transfer. Remount the staging share read-only and verify its actual mount options before use.

Integrated Build model smoke test on 2026-11-01: one authorized invocation through the isolated VM adapter answered `4` to “What is two plus two? Please answer briefly.” in 3.038 seconds. Configuration: `grok-4.7`, low reasoning, 45-second deadline, one turn, no retries, requested 1,200 visible-token limit. All nine isolation checks passed. The guest credential profile and Grok process were absent after completion; the disposable VM was stopped and removed. The adapter returned `usd: null` with no token totals; accounting correctly retained one missing call for each usage field. Actual token consumption and cost remain unverified, not zero. Evidence: `runs/grok-build-model-smoke-2026-11-01/verification.json` and `result.json`. This validates one simple model invocation, not discussion reliability or a hard spending ceiling. Inference was enabled only for that command, with no persistent configuration change.

## Grok smoke-test investigation (2026-11-01)

The saved live result reported 526 output tokens, including 507 reasoning tokens. The remaining 19 non-reasoning tokens are consistent with the requested 128-token visible-answer cap. Our earlier interpretation as an output-limit violation was incorrect: [xAI documents the limit as visible-answer-only](https://docs.x.ai/developers/model-capabilities/text/best-practices). It is not a total-token or spending ceiling.

The request omitted reasoning effort; [Grok 4.7 defaults to high and cannot disable reasoning](https://docs.x.ai/developers/model-capabilities/text/reasoning). That makes reasoning consumption unsurprising, but does not establish why the model refused the marker.

The adapter sent one user message, no tools, no prior conversation ID, and `store:false`. It returned a completed response whose text explicitly declined the exact-token instruction. Authentication/connectivity succeeded; exact-format compliance failed. There is no saved moderation reason or full raw response, so a provider policy, false-positive classifier, or other internal cause cannot be confirmed from this sample. The credential's former variable name was a local configuration issue; the smoke runner mapped its value to `XAI_API_KEY` before sending the authenticated request.

The original `runs/grok-live-smoke-2026-11-01T12-36-19-497Z/result.json` is preserved. Its sibling `assessment.json` records the corrected interpretation. No new live calls were made during investigation.

Before another authorized smoke run: distinguish transport success from answer correctness, use a benign semantic task (for example, "What is 2 + 2?"), explicitly configure reasoning effort in the request, record sanitized request/response status metadata, and retain the visible-token limit and timeout. Lower reasoning effort can reduce work but does not enforce a hard total-token or USD ceiling. The adapter now accepts `GROK_REASONING_EFFORT=low|medium|high|xhigh`; leaving it unset preserves the provider default. The dedicated semantic smoke runner explicitly selects low effort.

## Explicit live Grok semantic smoke test

After credentials are configured in the ignored `.env`, run `npm run smoke:grok -- --live` only when a paid request is intended. Omitting `--live` refuses to run. This command asks "What is two plus two? Please answer briefly." once with `reasoning.effort: low`, a 45-second deadline, 128 visible output tokens, no tools or prior response ID, and no retries. It uses `GROK_MODEL` when set, otherwise `grok-4.7`.

The first revised live run passed all checks on 2026-11-01: one request, echoed low effort, response `4.`, 1.205 seconds, 1252 input tokens, 35 output tokens (33 reasoning), and provider-reported cost $0.000986. This is a connectivity check, not a model-quality benchmark or proof of why the earlier marker was refused.

Results are saved under `runs/grok-semantic-smoke-<timestamp>/result.json`. Separate checks report endpoint reachability, HTTP success, response completion, and answer correctness. Reachability alone is not successful authentication. The answer check accepts a small documented-in-code set of equivalent forms such as `4`, `Four.`, and `Two plus two is four.`; other answers fail that check for review. A refusal can therefore pass connectivity and fail the answer check. Truncated/error responses are not graded.

The artifact records actual request count, requested settings, HTTP/response status, echoed reasoning effort when available, latency, normalized usage/cost, and public answer. It does not retain authorization headers or hidden reasoning. Neither low reasoning nor the visible-token limit creates a hard total-token or spending ceiling. The normal offline gate `npm run check` does not invoke this live command.

## Grounding (option A: pinned local snapshot)

By default `examples/demo-evidence.json` is included; it is explicitly synthetic and **not** a real Spine PKG. Supply your own reviewed, immutable snapshot:

```bash
export EVIDENCE_FILE="/path/to/published-pkg-evidence.json"
MODE=real npm start
```

Expected JSON shape:

```json
{
  "snapshotId": "spine-pkg-published-commit-sha",
  "items": [
    {"id": "pkg:SVC-42", "uri": "pkg://myrepo/commit-sha/SVC-42", "text": "Approved finding and provenance..."}
  ]
}
```

The POC calculates SHA-256 of the file and pins an evidence copy into the discussion prompt. File content (100 KB max) is truncated to 20 items, 1500 characters each, with the total prompt truncated separately. **Production must implement ranked retrieval and per-citation evidence verification**, not silent truncation.

## Grounding (option B: live read-only MCP lookup)

The server-side gateway can connect to one trusted **Streamable HTTP MCP** endpoint and invoke exactly one explicitly configured audited read-only tool, pinning its response in memory for the session:

```bash
export MCP_SERVER_URL="https://your-grounding-gateway.example/mcp"
export MCP_READ_TOOL="search_published_pkg"
export MCP_TOOL_ARGS_JSON='{"query":"retrieval architecture","snapshot_id":"<published-commit-sha>"}'
export MCP_SNAPSHOT_ID="<published-commit-sha>"
export MCP_BEARER_TOKEN="..."
MODE=real npm start
```

The tool's **actual server-side authorization** must enforce read-only behavior, published snapshots, tenant scopes, and approved fields; a read-looking tool name provides no guarantee. Verify that returned revision equals the requested published revision. The POC records a hash of the result, but **does not independently verify the server's claimed PKG version**. For production, require the response to contain structured `evidence_id`, `source_uri`, `commit_sha`, offsets, and provenance. Never connect an MCP service account with write permissions.

## Browser and API

- `POST /api/sessions` with `{ "prompt": "...", "maxRounds": 3 }`
- `GET /api/sessions/:id` session state
- `GET /api/sessions/:id/events` live Server-Sent Events, replay via `Last-Event-ID`
- `POST /api/sessions/:id/interventions` with `{ "message": "..." }` adds feedback at next round boundary
- `POST /api/sessions/:id/cancel` best-effort cancellation
- `GET /api/sessions/:id/report` generated Markdown report
- `GET /api/health`

Local service is bound to `127.0.0.1` only. There is **no user auth**, persistent resume index, or multi-user isolation; do not expose the port publicly. Run logs are persisted on disk and may contain sensitive prompts/provider outputs. The UI is a basic text transcript (one final message per agent turn), not token-by-token streaming.

## First implementation slice

Each discussion gets its own adapter instances; provider conversation state must never cross session boundaries. A discussion can run only once. Every completed round, including the final round, needs at least two successful participants; otherwise the result is partial.

The engine regression suite exercises independence, peer exchange, the nine-call limit, failure handling, cancellation, concurrent session isolation, and persisted events/reports using synthetic adapters. It does not establish paid-provider compatibility.

Provider selection and roster-derived call limits now support any two or all three implemented providers. Before adding Gemini or Ollama, separate participant IDs from provider/model configuration and add capability validation. Multiple models from the same provider are not yet supported.

Live integration gate completed on 2026-11-01: nine successful responses in 50.8 seconds, with Grok low reasoning and 1,200 visible tokens (raised from the earlier 256-token discussion allowance). All nine synthetic cache answers matched expected totals. Requested 100-word brevity was not consistently followed. Evidence is retained in `runs/e2e-live-2026-11-01T13-31-17-433Z/verification.json` and `audit.json`. SDK versions, per-invocation deadlines, and normalized usage are implemented and tested offline. Strict budget reservations, durable recovery, explicit round-boundary pause/resume, and verified evidence provenance remain open.

## Architecture and production roadmap

See [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md). Production additions include full JSON schema outputs, citation validation, true hard cost controls, indexed event storage, RBAC/OIDC, durable resumable sessions, per-turn token streaming, rate limiting, timeouts, DLP, prompt-injection tests, and reproducible benchmarks.

## Three-provider discussion with isolated Grok Build (2026-11-01)

One authorized bounded run completed all three rounds and nine responses in 54.906 seconds, using Anthropic and OpenAI adapters plus Grok Build in the isolated VM. Verification passed for independent round-one prompts, both prior-round peers in every later prompt (zero clipping), own history, pinned synthetic evidence, event persistence, usage reconciliation, and the complete final report. All nine replies included the expected toy latencies: no cache 50 ms, FIFO 41 ms, LRU 32 ms.

Known token totals cover six calls: 140,344 input and 2,913 output; Grok Build's three calls have unknown token usage. Known cost is $0.0882352 from Anthropic estimates; all three Codex and three Grok costs remain unknown. The final report preserves these missing-call counts and incomplete metering. Brevity was not consistently followed, and Grok repeated an unsupported statement about miss costs despite correct totals; this run does not establish general answer quality.

All temporary guest profiles/processes and the host test workspace were removed; the disposable VM was stopped and deleted. No discussion rerun or fourth-model synthesis occurred. Evidence and review: `runs/e2e-build-2026-11-01/verification.json`; final report: `runs/e2e-build-2026-11-01/8f6a7f0d-75b4-4c14-849a-d81068f7ad00/report.md`.

## Grok Build usage tracking (offline change, 2026-11-01)

Build exposes aggregate per-prompt accounting in the `session/prompt` result's `_meta.usage`. The pinned 1.0.70 binary's embedded documentation explicitly describes this shape. The implementation was checked against xAI source revision `2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8`: [metadata construction](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-shell/src/agent/mvp_agent/mod.rs) and [usage serialization](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-shell/src/extensions/notification.rs).

The adapter now maps aggregate `inputTokens`, `outputTokens`, `cachedReadTokens`, `cacheCreationTokens`, and `reasoningTokens` into normalized accounting. Input already includes cache reads/creation; output includes reasoning. These breakdowns and per-model rows are not added again. Sibling `_meta` counters describe the last model call, and sibling `totalTokens` describes context occupancy; neither is used as prompt billing. Stream usage/context snapshots are ignored, avoiding duplicate or cross-session accounting. There are no extra usage RPCs or persisted credential-dependent queries.

A ledger marked `usageIsIncomplete` remains unknown in normalized totals rather than making an undercount look complete. Invalid or absent counters remain missing, while explicit valid token zeros are preserved. Positive safe-integer `costUsdTicks` are converted at 10^10 ticks per USD only when usage is complete and `costIsPartial` is absent/false. Missing, malformed, partial, or zero-sentinel costs stay `usd: null`; no price estimate or subscription billing assumption fills the gap. Only allowlisted numeric fields are retained. Complete recorded usage survives truncated/empty answers and cleanup failures. Errors without terminal usage remain unknown.

The final report explicitly states how many calls lack trustworthy USD accounting and that a known subtotal is not the total bill. Prior run reports remain unchanged: raw terminal metadata was not retained, so their missing token totals cannot be reconstructed. Offline tests cover aggregate precedence, no double counting, malformed/zero/partial fields, unknown costs, failure accounting, and report reconciliation. No new live model test was run; emission on the installed binary still needs verification in a future authorized run. Earlier statements about unavailable Build usage describe those historical runs before this parser was added.

Live usage verification on 2026-11-01: one bounded isolated Build invocation answered `4.` in 2.177 seconds. The new parser captured 11,889 input tokens (including 1,536 cache reads), 30 output tokens (including 28 reasoning tokens), zero cache-write tokens, and $0.021654 in provider-reported usage cost. All normalized metrics reconciled with zero missing-call counts for this invocation. Provider-reported cost is not proof of an invoice charge or subscription deduction; actual billed cost remains unknown. All nine isolation checks passed, guest credential profiles/processes were absent after completion, and the disposable VM was stopped and removed. Evidence: `runs/grok-build-usage-smoke-2026-11-01/verification.json`; standalone report: `runs/grok-build-usage-smoke-2026-11-01/report.md`. Earlier reports retain their original missing accounting; no historical totals were backfilled.

Three-provider usage rerun on 2026-11-01: all nine responses completed in 57.780 seconds, with round-one independence, both peers in later prompts (no clipping), complete report coverage, and reconciled usage. All nine calls supplied input/output token counts: 179,904 input and 6,923 output total. Grok Build supplied 39,081 input and 3,758 output across its three calls, with $0.080742 provider-reported cost. The overall known subtotal is $0.1660603 (Anthropic estimates plus Grok reports); three OpenAI/Codex costs remain explicitly unknown in the final report. This is not a confirmed invoice or subscription deduction. Guest credential profiles/processes and the host workspace were cleaned up, and the disposable VM was removed. Evidence: `runs/e2e-build-usage-2026-11-01/verification.json`; report: `runs/e2e-build-usage-2026-11-01/fa19b974-82ec-4f95-bd4b-3996492a6fb6/report.md`. No unrequested retry or fourth-model synthesis occurred.

## Subscription configuration validation — 2026-11-01

Validation passed: TypeScript checking, 92 Node tests, 8 Python guest tests, and a localhost mock HTTP/SSE discussion with six replies. This change was validated offline only: all provider pairs, three-provider selection, invalid rosters, sanitized SDK environments, subscription auth settings, documented Codex token counters, explicit missing costs, and six-response peer exchanges/report persistence. No login checks, model requests, credential transfers, or VM provisioning were performed.

The installed pinned SDK declarations and implementation are the source for Codex accounting; see also [Codex SDK](https://learn.chatgpt.com/docs/codex-sdk), [Codex authentication](https://learn.chatgpt.com/docs/auth), and [Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference). Local login settings do not establish current service entitlement.

PKG impact measurement on the working checkout found `Engine.run` as a caller of `composePrompt` and `makeReport` (one each). Adapter methods and the factory had zero resolved callers; these are floors, not proof of isolation. TypeScript untraced calls are not tracked. `Engine.run` had two related documents. Regression lookup did not resolve qualified methods and reported prompt/report paths and factory as uncovered; explicit offline regressions exercise them. Server module initialization/UI script changes have no applicable symbol nodes in file insights and were checked through mock HTTP instead.

Two-provider subscription validation on 2026-11-01: one authorized Codex–Claude discussion completed all six responses across three rounds in 22.145 seconds. Preflight confirmed ChatGPT login and Claude Max (`claude.ai`) using sanitized environments; no API keys were forwarded. Round one was independent, and each later prompt included exactly one previous-round peer with no clipping. Usage reconciled to 138,474 input and 2,988 output tokens. Claude's $0.0789282 is an SDK estimate, not a subscription invoice; all three Codex costs remain explicitly unknown. Synthetic cache calculations and substantive peer critiques were reviewed. The requested 100-word brevity was not consistently followed. There were no provider failures or orchestrator retries; no additional model run was made. Temporary workspace removed, no credentials copied, no VM started. Evidence: `runs/e2e-subscription-pair-2026-11-01/verification.json`, `preflight.json`, `audit.json`, and `11a2ae21-5f60-4db8-808f-300b9573aab8/report.md`.

## Provider and model selection in the UI

Before starting, select at least two distinct providers and optionally enter a model ID for each. Leaving a model field blank uses that provider's displayed server default (`CODEX_MODEL`, `CLAUDE_MODEL`, or `GROK_BUILD_MODEL`); an unset Codex/Claude default uses the SDK default. Providers are selectable regardless of the initial `KOINOUS_PROVIDERS` selection unless disabled with `KOINOUS_DISABLED_PROVIDERS`. Disabled providers are omitted from the UI catalog and rejected for new API sessions; saved discussions remain readable. Model IDs are text fields, not a fetched entitlement catalog: syntax is checked locally, while actual availability depends on the subscription. Gemini and Ollama remain future adapters.

Deselected model fields are disabled and omitted from requests. The form shows the planned call cap and locks choices while running. Editing a later draft does not alter a completed session's call cap. The API independently rejects fewer than two providers, duplicate/unknown providers, malformed or oversized model IDs, overrides for unselected providers, and authentication/transport fields in the selection. Selection never enables Grok inference, provisions a VM, or enables API-key fallback.

The server snapshots resolved models and provider order at session creation. Concurrent sessions use instance-local model settings, without changing `process.env`. The session API, `session.created` and `participants.configured` events, and final report retain this snapshot. Requested IDs are distinct from provider-reported model IDs; defaults are not represented as verified actual models. Existing subscription login, tool restrictions, read-only protections, timeouts, usage tracking and unknown-cost reporting remain intact.

`POST /api/sessions` accepts, for example:

```json
{
  "prompt": "Compare the synthetic cache policies.",
  "maxRounds": 3,
  "selection": {
    "providers": ["codex", "claude"],
    "models": {"codex": "", "claude": ""}
  }
}
```

Omitting `selection` preserves environment-based defaults. `/api/health` provides the initial roster plus all supported provider labels and default models. No API keys or auth options are exposed by the UI.

Offline validation: 123 Node tests, eight guest tests, and source/test typechecking passed. Browser checks verified minimum-two validation, disabled running controls, model fields, and completed six-response mock discussions for Codex/Claude and Codex/Grok. No live models, auth checks, credential transfers, or VMs were used. Evidence is under `runs/ui-offline-2026-11-01/`.

PKG measurements: `launchBuild` has one resolved caller (`GrokBuildAdapter.run`); `makeReport` has one (`Engine.run`). Both corresponding callers were reported as regression gaps. Adapter methods, factory, engine methods, and `Session` had zero resolved callers; qualified method regression lookups were unresolved. These are floors, with TypeScript untraced calls not tracked. Relevant documentation included README's subscription validation and Build sections. The scan also surfaced unrelated bundled documentation under ignored `runs/`; those matches were not treated as product guidance. Full measurement output was saved outside the checkout at `/private/tmp/koinous-ui-impact.json`. Offline adapter, API, concurrency, report and browser tests cover the affected paths.

UI subscription smoke test on 2026-11-01: one discussion was submitted through the UI with explicit `gpt-6-astra` and `claude-opus-5-5` selections. All six responses completed across three rounds in 21.381 seconds. ChatGPT and Claude Max login preflight passed with API credentials excluded. Requested model snapshots, independent first round, one peer per later prompt (no clipping), prior positions, evidence hash, persisted events and final report all verified. Usage totals: 134,196 input and 2,816 output tokens. Claude's $0.0746878 SDK accounting estimate is not a subscription invoice; all three Codex costs remain unknown. Claude reports auxiliary Haiku usage alongside Opus; Codex does not expose an actual-model field. Synthetic calculations were reviewed; two replies exceeded the requested 100-word brevity. No provider failures, orchestrator retries or second model attempt occurred. The temporary workspace and bounded server were cleaned up. Evidence: `runs/ui-subscription-live-2026-11-01/verification.json`, `ui-completed.png`, and `a12a9f10-0d89-4bb3-bb98-0c1cd6b460ad/report.md`.

Three-provider UI subscription test on 2026-11-01: one UI-submitted discussion selected `gpt-6-astra`, `claude-opus-5-5`, and `grok-4.7` through isolated-VM Grok Build. All nine responses completed in 63.549 seconds, with independent round one, both peers in later prompts (no clipping), explicit model snapshots and reconciled usage in the saved final report. Tokens: 180,832 input / 8,587 output; Grok contributed 39,269 input / 4,317 output. Known accounting subtotal: $0.2150809 (Claude estimate $0.1169769 plus Grok reported $0.098104); three Codex costs remain unknown, and no amount is asserted to be a subscription invoice. Seven replies exceeded the requested 100-word brevity. The first disposable VM suffered a lifecycle/boot-provisioning failure before inference; it was replaced, with sandbox protections unchanged. The fresh VM passed all nine isolation checks and subscription authentication before the sole model attempt. No provider failed and no orchestrator retry occurred. Guest credentials/processes, host workspace and staging were cleaned up; the VM was removed and the UI server stopped. Original cached browser credentials were preserved. Evidence: `runs/ui-three-subscription-2026-11-01/verification.json`, `cleanup.json`, `ui-completed.png`, and `a2417410-0791-4f18-a4cd-25c069527f8b/report.md`.

## Managed Grok Build VM lifecycle

The application's default Grok runtime is now `managed-vm` when `GROK_BUILD_RUNTIME`
is unset. An explicit `GROK_BUILD_RUNTIME=vm` retains the operator-provisioned path;
set `managed-vm` explicitly to migrate an existing `.env`. Mock mode creates no VM.
Codex/Claude-only selections create no VM. Subscription login and minimum-two-provider
selection remain mandatory; there is no API-key fallback.

Configure these **locally**, without committing credentials:

```dotenv
GROK_TRANSPORT=build
GROK_BUILD_RUNTIME=managed-vm
GROK_BUILD_PODMAN=/opt/podman/bin/podman
GROK_BUILD_LINUX_BINARY=/absolute/path/to/pinned/linux-arm64/grok
GROK_BUILD_AUTH_HOME=/absolute/path/to/dedicated/browser-login-profile
GROK_BUILD_VM_IMAGE=/absolute/path/to/approved/applehv-arm64-image
GROK_BUILD_VM_IMAGE_SHA256=<verified-64-character-lowercase-sha256>
# Enable only when a discussion is authorized:
GROK_BUILD_ENABLE_INFERENCE=1
```

The runtime requires macOS arm64, AppleHV Podman (previous manual validation used
5.8.3), and a locally staged, approved guest image containing Python 3, `findmnt`,
`bubblewrap`, and a nonroot SSH user with permission to remount the one shared
volume read-only. It does not download an unpinned image, install guest dependencies,
or weaken a sandbox to make an incompatible image boot. Grok Build remains pinned
to Linux arm64 1.0.70 SHA256
`3aa36883574b263088e5addffe241f55430e8daaee1a0c4934b02180007a9761`.
Image SHA256 is operator-supplied and checked before provisioning. Keep the approved
image free of credentials, hooks, and custom Grok system policy. Hash pinning verifies
identity, not whether an arbitrary image is trustworthy.

One selected Grok adapter owns one uniquely named VM for the discussion. Before any
provider receives a model prompt, the app:

1. Checks artifact hashes and takes an exclusive per-user lifecycle lock.
2. Rejects an existing running/starting Podman VM; it never stops another owner's VM.
3. Stages only the pinned binary and bundled guest/probe scripts in a private host
   directory, initializes a 2-CPU / 2-GiB / 10-GiB VM, and starts it.
4. Remounts the sole host share read-only. A synthetic credential probe runs through
   the production bubblewrap envelope and checks root/workspace read-only access,
   hidden host/guest homes, sockets, staging and other profiles, writable private
   profile, and credential mode 0600. All nine checks and probe cleanup must pass.
5. Authenticates with Grok using browser credentials over SSH stdin only. This
   preflight sends no `session/new` or model prompt.

The discussion retains the existing three-round maximum, low Grok reasoning,
1,200 completion-token configuration, disabled tools and subscription authentication.
Each Grok invocation receives its own temporary guest credential profile; its bridge
removes that profile. Neither stage files nor ownership journals contain credentials.
The per-session VM connection is immutable; concurrent sessions cannot redirect each
other by changing global environment variables.

Success, provider failure, cancellation, and failed preparation all enter teardown.
The manager checks guest profile absence, attempts stop and removal, and independently
checks the VM inventory. A failed credential check does not prevent VM destruction;
the audit records whether pre-removal profile deletion was actually observed. The app
only reports runtime cleanup complete after VM absence and host-stage deletion are
confirmed. Source browser credentials remain untouched. Cleanup failure makes the
session fail even if all model answers succeeded. Events and the final report record
the lifecycle; the UI stays busy through cleanup. SIGINT/SIGTERM reject new sessions,
cancel active work, and await teardown. Commands have bounded output and deadlines;
cancellation waits for the child command to exit before subsequent cleanup.

### Crash recovery and operational limits

Normal failure/cancellation paths are automated. A hard kill, power loss, or failed
Podman removal cannot guarantee immediate teardown. The private ownership journal is
`~/.local/state/koinous/grok-vm.lock/owner.json`; an unresolved lock blocks subsequent
managed Grok discussions. Successful cleanup saves a non-secret audit beside the lock
as `koinous-grok-<uuid>.json`. Do not delete a lock just to bypass the guard.

For recovery, first stop the owning app process and inspect the journal. With the
same Podman binary and `CONTAINERS_MACHINE_PROVIDER=applehv`, inspect the inventory,
then stop/remove **only the exact owned VM named in the journal**. Verify that it is
absent before deleting that journal's exact staging directory and lock. Preserve the
journal as an audit record. Never bulk-delete VM names, guest profiles, or proxy
processes. Recovery after an abrupt process death is deliberately operator-led; the
app does not guess ownership from a name prefix. Do not independently start another
Podman VM while a managed discussion is running; the lock coordinates Koinous
instances, not unrelated Podman clients.

No VM, authentication, credential transfer, or live model test was run for this
change. Offline tests exercise provisioning failures, sandbox rejection, cancellation,
locks, teardown retry, shutdown, explicit connection routing, usage/report retention,
and the production guest sandbox controls. Real boot compatibility of a newly selected
image remains unverified until a separately authorized infrastructure preflight.

PKG measurements before edits: `Engine.run` had one resolved caller
(`createApplication`); `launchBuild` had one (`GrokBuildAdapter.run`);
`spawnIsolatedBuild` had one (`launchBuild`); `makeReport` had one (`Engine.run`).
`createAdapters` and `Adapter` had zero resolved callers. Regression gaps identified
Build launch/adapter paths; the qualified engine lookup was unresolved. The server
factory was reached by API tests. The graph found no symbol for the inline UI event
handler, so its edit used source inspection and the existing offline DOM harness.
TypeScript/JavaScript untraced calls are not tracked; these counts are floors, not
complete blast-radius claims. README subscription/selection sections were linked by
the graph. Full measurements and test log are outside the checkout under
`/private/tmp/koinous-managed-vm/`.

## Provider app history and shared recommendations

Authentication and conversation placement are separate capabilities. The
[Codex SDK](https://learn.chatgpt.com/docs/codex-sdk) controls local Codex threads;
the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/sessions) persists
sessions to local disk. Neither fact establishes automatic placement in ordinary
ChatGPT or Claude web chat. Native-app discoverability should be verified explicitly
before the product promises it.

[Grok Build sessions](https://docs.x.ai/build/features/sessions) are also persisted
locally, including ACP sessions. Its [enterprise documentation](https://docs.x.ai/build/enterprise)
describes remote sync/sharing through `code.grok.com`, but we have not verified that
feature for the pinned CLI/ACP transport or its relationship to ordinary Grok chat.
Our temporary Grok profiles are removed after each call, and the VM is destroyed;
Koinous retains the returned transcript and reported IDs. Do not depend on those
removed profiles for later native-session resume.

Recommended next product step: make the Koinous session the canonical record, with
one export containing the transcript, requested/returned models, usage, participation,
provider recommendations, unresolved disagreements, and runtime outcome. The current
report assembles the three rounds deterministically and includes each provider's
Round 3 recommendations; it is not a new model-written consensus summary, and is
not automatically sent to the providers. Add an explicit summary/export action first,
then optional supported publishing adapters with separate per-destination delivery
status. Upload/paste the same report manually where no supported integration exists.
Optional model reflection on that report would be additional, separately authorized
calls; it must not silently turn a nine-call discussion into twelve calls. Preserve
unknown subscription costs rather than assigning API prices.

Managed lifecycle validation (2026-11-01): `npm run check` passed source/test
TypeScript checking, **146 Node tests and eight Python guest tests**. Both guest
scripts also passed Python syntax parsing. All newly exercised providers, VM commands,
and authentication responses were offline fakes; no live lifecycle was attempted.

### Infrastructure-only managed preflight

With the approved local image/hash configured, run:

```sh
node --env-file=.env --experimental-strip-types scripts/grok-managed-infra-preflight.ts runs/managed-infra-preflight
```

This entry point invokes the same production lifecycle but never constructs a model
adapter, reads browser credentials, authenticates, or creates an inference session.
It uses only the synthetic credential fixture in the sandbox probe, and always
attempts lifecycle disposal. Keep `GROK_BUILD_ENABLE_INFERENCE=0` for this check.
Its verification artifact records all nine checks, credential-profile absence,
VM inventory/removal and host staging cleanup. Passing is infrastructure evidence,
not proof of subscription authentication or model entitlement.

The first managed infrastructure attempt exposed Podman's 30-character VM-name
limit. Generated names now use a 16-hex-character random suffix (29 characters total),
with the existing inventory collision check unchanged. A regression test covers the
limit. Pre-edit PKG measurement found zero typed constructor callers, no linked docs,
and no resolved qualified regression lookup; TypeScript untraced calls are not tracked.
Measurement evidence: `/private/tmp/koinous-managed-vm/infra-constructor-impact.json`.

Managed infrastructure validation (2026-11-01): the cached AppleHV `.raw.zst` image
was locally pinned to SHA256
`5196ab050d38f01ae48435b96ef9fff30ad8b7f263aa63231022e46c382b9ba4`.
This records the local artifact's identity; it is not an independent publisher-signature
verification. After correcting the VM-name limit, the managed lifecycle successfully
initialized and booted the image, passed all nine sandbox checks, verified synthetic
credential-profile deletion, stopped/removed the VM, and removed staging and the lock.
The local configuration now selects `managed-vm`, the pinned image and persistent
pinned Grok binary under ignored `runs/runtime/`, with inference disabled. Zero real
credential transfers, zero authentication requests, and zero model requests occurred.
Quality gate: 150 Node tests, eight Python tests, and TypeScript checking passed.
Evidence: `runs/managed-infra-2026-11-01/verification.json`; the failed initial attempt
is preserved as `attempt-1-name-limit.json` in the same directory.

### Authentication-only managed preflight

Keep `GROK_BUILD_ENABLE_INFERENCE=0` and run:

```sh
node --env-file=.env --experimental-strip-types scripts/grok-managed-auth-preflight.ts runs/managed-auth-preflight
```

This provisions and verifies the production managed VM, sends the dedicated cached
browser credential over SSH stdin, and requests only ACP `initialize` and
`authenticate` with `grok.com`. A transport guard rejects any other outgoing request
method, including `session/new` and `session/prompt`. It records method names only,
checks that the source credential is unchanged, and always attempts lifecycle
cleanup. Success requires guest credential-profile absence, VM removal, staging
removal, and lock removal. It does not enable inference or establish model entitlement.

### Historical original-roadmap snapshot — 2026-11-01

Superseded by the current overall table in `docs/IMPLEMENTATION_PLAN.md` and the
P3 acceptance update below; retained as a record of the earlier baseline.

The original P0–P6 plan targets a pilot-quality internal service, beyond the local POC.
Use each original engineer-day range's midpoint as the phase weight: 2.5, 4, 5, 4,
4, 6.5, 4 (total 30). For this conservative baseline, each phase has one acceptance
step: its original exit gate. P0/P1 passed; later phases receive no completed-gate
credit yet, even where enabling implementation exists. Thus gate-verified progress is
6.5/30 = **21.7% (about 22%)**, not a forecast of effort remaining. Earlier 100% bars
were individual requested tasks, not this overall roadmap.

| Phase | Weight | Gate status | Evidence or missing gate |
|---|---:|---|---|
| P0 — Mock POC | 2.5/30 | Complete, 1/1 | UI, three rounds, nine mock responses, repeatable tests |
| P1 — Provider integration | 4/30 | Complete, 1/1 | Previous subscription-only live three-provider run: nine replies, peer exchanges, usage, no tools; configurable two/three providers and models |
| P2 — Published PKG grounding | 5/30 | In progress, 0/1 | Local snapshots and optional MCP read exist; authoritative revision/index matching and resolvable per-claim provenance remain |
| P3 — Claims and dissent validation | 4/30 | To do, 0/1 | Prompts/report preserve dissent; typed claims and unsupported-claim validator remain |
| P4 — Hard budget controls | 4/30 | In progress, 0/1 | Usage, timeouts, cancellation and call caps exist; concurrent reservations and hard budget acceptance tests remain |
| P5 — Security/deployment hardening | 6.5/30 | In progress, 0/1 | Subscription isolation and VM sandbox/lifecycle exist; authenticated control plane, tenant isolation, DLP and full security-negative gate remain |
| P6 — Evaluation/operations | 4/30 | In progress, 0/1 | Smoke evidence, failure tests and recovery instructions exist; reproducible baseline comparison and SLO dashboard remain |

P1 uses the user's revised subscription-only requirement; the original API-key
proposal is preserved as history. Full managed-lifecycle **model** discussion has
not been rerun: earlier model evidence used the isolated, operator-provisioned VM.
Consumer-app history mirroring and publishing a common summary are additional product
scope, not completed features or gates in the original seven-phase denominator.
For P4, subscription costs may remain unobservable; any revised strict token/call
budget contract should be agreed explicitly rather than claiming a hard USD ceiling.
Next roadmap priority: P2's published immutable evidence and stale-index rejection.

Managed subscription authentication validation (2026-11-01): one managed VM passed
all nine sandbox checks and one `grok.com` authentication request. The observed ACP
methods were exactly `initialize`, `authenticate`; zero model requests occurred.
The source credential remained unchanged, guest credential profiles were absent,
and VM/staging/lock removal passed. Inference remained disabled throughout. Evidence:
`runs/managed-auth-2026-11-01/verification.json`. Offline quality gate passed 155
Node tests, eight Python guest tests, and source/test TypeScript checking.

## P2 — pinned published PKG grounding (offline implementation)

The prior MCP path accepted an environment label as a snapshot ID. Strict PKG mode
now requires a **locally approved publication manifest plus its SHA-256 pin**. It
verifies the actual search revision, every declared index revision, exact excerpt
hashes, and resolved source locations against that manifest before provider runtime
preparation or model dispatch. There is no fallback to unverified MCP text on failure.

The trust anchor is the reviewed publisher artifact, not a server's self-assertion.
Obtain the manifest and expected digest from the reviewed post-merge publication
process, approve them outside the model workflow, and pin both locally. Matching a
hash establishes identity; it does not independently audit CI, establish publisher
identity, validate source-code correctness, or make a working-tree export published.
Do not automatically calculate and accept a new digest from an untrusted response.
The gateway and its credential must enforce read-only access and repository scope;
client method allowlisting alone cannot enforce server-side permissions.

Configuration for a gateway implementing the **Koinous P2 v1 contract**:

```dotenv
PKG_MANIFEST_FILE=/absolute/path/to/approved/publication-manifest.json
PKG_MANIFEST_SHA256=<approved-sha256-of-exact-manifest-file-bytes>
MCP_SNAPSHOT_ID=<approved-immutable-publication-id>
MCP_SERVER_URL=https://your-read-only-gateway.example/mcp
MCP_READ_TOOL=search_pkg
MCP_TOOL_ARGS_JSON={"top_k":8}
GROK_BUILD_ENABLE_INFERENCE=0
```

`MCP_BEARER_TOKEN`, if required, remains server-side. The session question supplies
the retrieval query; a configured `query` is only used when the loader is called
without a question. `MCP_TOOL_ARGS_JSON` permits only `query` and `top_k` (1–20).
Repository, commit, snapshot and provenance entity IDs are owned by the validated
manifest/selection, never arbitrary tool arguments. HTTPS is required except for
localhost development. Each SDK request has a ten-second timeout and accepts the
session cancellation signal. No new SDK or dependency was introduced.

This is an explicit gateway contract, **not a claim that the connected Spine server
already publishes these exact tools/envelopes**. A production gateway integration
and a real approved publication are still required to close P2's overall exit gate.

### Manifest and retrieval contract

See `examples/published-pkg/manifest.json` and `evidence.json` for complete synthetic
examples. The adjacent `manifest.sha256` pins the fixture bytes only; these examples
are not real published project evidence.

The manifest contains:

- `schema_version: 1`, `snapshot_id`, `repository`, and a full 40-hex `commit_sha`.
- `publication`: `status: "published"`, `pipeline_id`, and true `reviewed`, `merged`,
  `checks_passed` flags from the approved publisher record.
- `indexes`: nonempty, uniquely named index revisions; each `snapshot_id` and
  `commit_sha` must match the publication. Search must return this exact index set.
- `entities`: unique `entity_id` entries with repository-relative `path`, positive
  inclusive `start_line`/`end_line`, exact UTF-8 excerpt `text_sha256`, and canonical
  `pkg://<repository>/<commit>/<path>#L<start>-L<end>` URI. The v1 entity represents
  the exact excerpt/range, not an arbitrary substring of a larger source file.

Only `search_pkg` and `get_provenance` are called, after MCP initialization and tool
listing. The adapter sends the same `snapshot_id`, `commit_sha`, and `repository`
on both requests. Search additionally receives `query` and `top_k`. Its response
contains those three pins, `indexes`, `results` (`evidence_id`, `entity_id`, `text`),
and honest `total`/`truncated` fields. Result IDs must be unique and each text must
hash to its manifest entity. Empty or oversized result sets fail closed.

The provenance request contains exactly the selected `entity_ids`; its response
contains the three pins and `entities` in manifest-entry form. Missing, duplicate,
extra, wrong-revision, changed-range or changed-hash resolutions are rejected. Either
MCP `structuredContent` or one JSON text block is accepted; tool errors are rejected.
Source URLs are compared, not fetched, preventing arbitrary evidence-driven requests.

The returned evidence pack is deeply frozen and canonically hashed with publication
metadata. The same pack enters every discussion round. Its complete serialized
prompt payload must fit the existing 18,000-character evidence allowance: otherwise
retrieval fails with a request to reduce `top_k`, rather than clipping verified
excerpts or breaking JSON. Prompts and reports expose returned/total reported search
matches and partial-retrieval status. Reports include publication/manifest identity,
resolvable evidence IDs, source ranges, excerpt hashes and excerpts. This resolves
**evidence provenance**; deciding whether a model's claim is supported remains P3.
No cross-session evidence cache is introduced, so a stale cache cannot bypass pin
validation. Repeated equivalent inputs produce the same evidence hash.

### Offline validation and migration

For an offline captured gateway response, omit `MCP_SERVER_URL`, set the same three
manifest/pin/snapshot variables, and set `EVIDENCE_FILE` to a JSON object containing
`search` and `provenance` envelopes. Tests exercise this path through the real engine
with fake providers, and exercise the pinned MCP SDK client/server over an in-memory
transport. Neither path needs network access, subscription credentials or models.

With no PKG configuration, the existing curated/synthetic local snapshot format still
works and is explicitly labelled **published provenance unverified** in reports.
Partial PKG configuration fails closed. Existing MCP deployments must migrate from
label-only results to the new contract; arbitrary `MCP_READ_TOOL` names and revision
overrides are deliberately rejected. No local `.env` publication pins were invented
or configured during implementation; inference remains disabled.

Measured PKG impact: `getEvidence` → `Engine.run`; `mcpEvidence` → `getEvidence`;
`composePrompt` and `makeReport` → `Engine.run`; engine → server factory. Each had one
resolved caller. `Evidence` had zero typed callers. Regression results linked the
API test setup for grounding/prompt/report paths; the qualified engine regression
lookup was unresolved. TypeScript untraced calls are not tracked, so these are floors.
A bundled skill reference under ignored `runs/` was a scanner artifact, not product
guidance. Full measurement: `/private/tmp/koinous-p2-impact.json`.

P2 implementation and offline validation are complete for this contract. Overall
roadmap progress remains **21.7% (~22%)** under the established completed-phase-gate
method until a genuine reviewed publication and compatible gateway pass read-only
integration checks. No model test is required for that next grounding validation.

P2 real-publication discovery (2026-11-01): the configured Koinous environment has
no publication manifest, trusted digest, snapshot pin or HTTP gateway. The connected
Spine 3.68.0 server runs over stdio and exposes local comprehension tools. Neither
the installed plugin nor the inspected Spine checkout contains `search_pkg` or
`get_provenance`. Its post-merge Episteme workflow regenerates Markdown knowledge;
no matching P2 manifest/digest publication was identified. The only matching Koinous
manifest is the synthetic example, which is not approved project evidence.
Consequently real provenance/stale-index integration checks were **not run**; the
prior offline results do not close P2. No inference, VM operation, credential change,
or configuration change occurred. A separate deployment may exist outside the
inspected configuration. Evidence and required inputs:
`runs/p2-publication-discovery-2026-11-01/discovery.json`.

## Idea discussions — current workflow

1. Enter an idea and optionally provide goals, constraints or background (up to
   6,000 characters each). Choose at least two providers and their model IDs.
2. Round 1 gives independent views; round 2 exchanges critiques; round 3 returns
   structured final positions after considering those critiques.
3. The UI and downloadable report present one final recommendation, the assessment,
   coverage, rationale, risks, next actions, dissent and missing/invalid responses.

No PKG, evidence file, gateway or publication manifest is required. The API defaults
`grounding` to `none`, independently of ambient MCP/PKG configuration, so an unavailable
configured server cannot block an idea discussion. The browser always sends `none`.
Existing strict grounding code and tests are retained as a future optional path:
advanced callers can explicitly request `grounding: "configured"`, but PKG integration
is deferred until **after the complete idea-discussion roadmap**, including D6.
Supplied context is unverified data, not authority to use tools or modify anything.

```json
{
  "prompt": "Should our team pilot a four-day workweek?",
  "context": "Eight people; maintain customer support coverage.",
  "grounding": "none",
  "maxRounds": 3,
  "selection": {
    "providers": ["codex", "claude"],
    "models": {"codex": "", "claude": ""}
  }
}
```

### Assessment and recommendation policy

Final positions use a bounded JSON schema: `direction` (proceed/revise/pilot/defer/
reject), `recommendation`, `rationale`, `risks`, `disagreements`, and `nextSteps`.
The engine parses this once into the owning entry, retains the raw reply and usage,
and emits `position.invalid` for malformed final output. No retry or repair-model
call is made. Historical entries can be parsed when assembling their report.

- **Agreement:** all selected providers supply valid round-3 positions, choose the
  same direction and recommendation wording (case/whitespace normalized), declare
  no unresolved disagreement, and the session completes successfully.
- **Direction alignment:** all final positions choose the same direction, but wording
  differs or objections remain. This is not semantic consensus.
- **Majority direction:** more than half of the *selected roster* support a direction,
  with at least two valid positions. Missing providers are not silently removed from
  the denominator. Minority recommendations remain visible.
- **Split:** at least two valid positions, but no majority direction.
- **Insufficient:** fewer than two valid final positions, including one/two-round runs.

When there is a majority direction, the single recommendation is the first supporting
provider's concrete proposal in the selected roster order. This is a deterministic,
**attributed representative proposal**, not a claim that other providers endorsed its
exact wording or that it is the best answer. All providers' rationales/risks and
unresolved objections are retained. Without a majority, the report gives an explicitly
labelled procedural recommendation to defer commitment and resolve the gaps through
success criteria and a reversible comparison. Failed/cancelled sessions are provisional.

This conservative first implementation avoids semantic guesses and hidden extra
model spending. It does not implement an additional model-written synthesis, fact
checking, or consumer-app publishing. Different phrasings of an equivalent view may
remain classified as alignment instead of agreement. D6 verified schema compliance
for all three selected providers in one bounded live discussion; this is not a guarantee
for every future model response. The three-round/call cap, subscription-only authentication,
sandbox protections, usage accounting and explicit unknown costs are unchanged.

`discussion.assessed` persists the canonical outcome before the final report and
`session.finished`. GET session status exposes the same outcome. The UI uses text
nodes for summaries and includes missing/invalid positions, not only successful votes.
The report places the recommendation before the complete transcript and accounting.

### Active roadmap and validation

The D1–D6 table in `docs/IMPLEMENTATION_PLAN.md` supersedes the original PKG-centered
sequencing. D1 20%, D2 15%, D3 20%, D4 20%, D5 15%, D6 10%; one gate each. D1–D5 are
implemented and offline-validated; D6 passed one authorized bounded subscription
discussion on 2026-11-01 (**100%**). All nine replies, complete peer exchanges, three
valid final positions, direction-alignment assessment and one attributed recommendation
passed. The managed VM passed all nine sandbox checks; temporary credentials and
the VM were removed. Independent verification also rejected missing-reply and
missing-peer negative controls. This run exercised the engine and report workflow,
not the browser UI. Evidence: `runs/idea-discussion-live-2026-11-01/verification.json`,
`independent-verification.json`, `sandbox.json` and `cleanup.json`.

Usage was 174,491 input and 4,391 output tokens. The known provider-accounting subtotal
was $0.1578813, with three unknown Codex call costs; it is not a subscription invoice.
No additional synthesis calls were made. Both inference flags remain disabled.
PKG remains deferred pending a separate user request. A completed
local roadmap does not imply multi-user production readiness or strict USD ceilings.

Real discussions require explicit `KOINOUS_ENABLE_INFERENCE=1` at the app API; Grok
also retains its separate inference opt-in. Both remain disabled locally. Do not
change either merely to try the UI: use mock mode for offline demonstration.

PKG measurement before edits: prompt/report each resolve to the engine; engine run
resolves to the server; server factory is reached by API tests. Session/Entry types
and MockAdapter.run have zero typed callers; qualified method regression lookups
were unresolved. JavaScript inline event handlers have no graph symbol; source
inspection and the offline DOM harness cover them. TypeScript/JavaScript unresolved
calls are not tracked, so counts are floors. README references were relevant;
provider-bundled documents under ignored `runs/` were scanner noise, not guidance.
Full results: `/private/tmp/koinous-idea-impact.json`. No source change was made in Spine.

Idea-discussion acceptance (2026-11-01): `npm run check` passed **218 Node tests,
eight Python guest tests and TypeScript checking**. The actual mock adapters completed
all nine replies and produced a final recommendation with declared unresolved issues.
Offline cases cover two/three providers, no PKG despite invalid ambient configuration,
optional context, agreement/alignment/majority/split, missing/malformed/duplicate final
positions, short sessions, provisional failures, API inference denial and UI rendering.
Zero live model/authentication requests or VM operations occurred. Evidence:
`runs/idea-discussion-offline-2026-11-01/verification.json` and `check.log`.

### Reopening saved discussions

Use **Saved discussions → Open saved discussion** to review a finished run. The
native server reads its existing `events.jsonl` and `report.md` under its output
folder (`runs/` by default), including nested run folders. No replay harness,
provider construction, authentication, model call, VM provisioning, or PKG retrieval
is needed. The resulting `?session=<UUID>` link reopens the discussion after a page
reload or server restart. The server must be running to use the link.

Completed, partial, failed and cancelled discussions are read-only. The UI restores
recorded replies, model selections, context, assessment, recommendation, dissent,
failures and accounting; it does not resume execution. The original report is served
unchanged. Older runs without a recorded assessment explicitly show that absence.
Both mutation endpoints reject finished discussions. With real inference disabled,
the Start discussion button remains disabled while saved-session review works.

`GET /api/sessions` returns paged, searchable readable summaries, matching and
discovered totals, an unavailable-record count and explicit discovery coverage. Discovery is bounded to five
folder levels, 1,000 traversed directories and 500 candidate session folders. The UI
reports truncation; the count is not a claim about unscanned folders. Event logs are
limited to 8 MiB/1,000 events and reports to 2 MiB. Symlinks are not followed. Missing,
incomplete, malformed, oversized or duplicate-ID records are unavailable, without
modifying them. A crash without a terminal event is not treated as a finished run;
this feature does not resume sessions or recover a VM.

Validation (2026-11-01): TypeScript, 225 Node tests and 8 Python tests pass. Native
browser verification reopened the existing D6 discussion after a server restart,
matching all nine replies, the recorded direction-alignment assessment, recommendation
and dissent. Evidence is in `runs/native-saved-sessions-2026-11-01/`. No live model
tests were run; inference remains disabled and PKG deferred.


### Search and pagination for saved discussions

Search by **idea text, session UUID, or status**, then use **Previous page** and
**Next page** to browse 50 matches at a time. Search is a case-insensitive literal
substring match with Unicode normalization, applied before pagination across all
readable discovered records. Enter submits search; Clear search restores the full
listing. Searching starts at page one; Refresh list preserves the applied search.
Neither action starts a provider or alters a saved discussion.

API: `GET /api/sessions?q=meeting&page=2&pageSize=50`. `q` is trimmed and limited to
200 characters; `page` is a positive integer up to 1,000,000; `pageSize` is 1–50
(default 50). Invalid parameters return 400. Results are ordered newest-first by
recorded creation time, with UUID as a deterministic tie breaker. Pages past the
last page clamp to the last available page; an empty search result uses page 1 of 1.
Each request rescans current records, so newly finished sessions can shift pages.

The response includes `page`, `pageSize`, `totalPages`, `hasPrevious`, `hasNext`,
`total` (matching count), `discoveredTotal` (all readable discovered records), and
`scanTruncated` (discovery was incomplete). The legacy `truncated` field remains
true when discovery is incomplete or matches occupy more than one page. The UI
uses `scanTruncated` to distinguish incomplete discovery from ordinary pagination.
The discovery/file bounds above remain unchanged; paging is not a search of folders
outside that boundary.

Validation: 231 Node tests, 8 Python tests and TypeScript checks passed. Offline
browser verification traversed 56 synthetic records, searched for the oldest record,
and reopened it read-only; temporary fixtures were removed. Native search also
reopened the existing nine-response D6 discussion. Evidence is in
`runs/saved-history-search-2026-11-01/`. Both inference flags remain disabled; no
live model tests were run and PKG remains deferred.


### Provider, model and date filters

Saved discussions can also be filtered by provider, **exact requested model ID**,
and creation date. Fill the controls and press Search (or Enter in the search box).
Filters combine with text search before pagination. Refresh and page navigation
retain the applied filters; Clear filters resets all filters and returns to page 1.

API example: `/api/sessions?provider=codex&model=gpt-6-astra&from=2026-11-01&to=2026-11-01`.
`provider` accepts `codex`, `claude` or `grok`; empty means any. `model` is an exact,
case-sensitive configured model ID (up to 128 characters), not a claim about which
model the service actually used. When both are present, that model must belong to
that provider's recorded selection. With no provider filter, any selected provider
may match the model. Missing legacy metadata does not match a provider/model filter.

`from` and `to` use `YYYY-MM-DD` and include the entire UTC creation day. Either end
can be omitted. Invalid calendar dates and reversed ranges return 400 with an error
shown in the UI. Responses echo the applied `filters` alongside page metadata.
Dates are interpreted in UTC even if the browser formats the date input locally.

The interface now uses translucent glass panels, soft gradient lighting and layered
borders, with responsive filter columns, readable dark controls and keyboard focus
outlines. An opaque fallback is available when blur is unsupported or reduced
transparency is requested. All styling remains local and dependency-free.

Offline acceptance: 235 Node tests, 8 Python tests, TypeScript, combined-filter
browser verification and desktop/mobile visual checks passed. No live model tests
were run. Both inference flags remain disabled and PKG remains deferred.


### Bookmark saved views

The address bar preserves applied `q`, `page`, `provider`, `model`, `from`, `to`
and the opened `session`. Bookmark or copy that URL to restore the same view after
reload. Draft edits are saved only when Search succeeds. Opening a discussion keeps
the list filters; Clear filters resets the list to page 1 while retaining the open
discussion. Existing session-only links still work.

The server validates URL inputs and clamps pages to the available results. Successful
loads update the URL to that effective page; failed restoration leaves the original
URL intact and displays an error. Unrelated parameters and fragments are preserved.
Updates replace the current history entry rather than creating a Back entry per
edit. Restoration only reads saved records and never starts providers or inference.

Offline validation: 239 Node tests, 8 Python tests and TypeScript passed, plus native
browser reload of a filtered nine-response discussion and an isolated page-two
fixture. Both inference flags remain disabled; PKG stays deferred.


### P3 claims and agreement validation — offline acceptance

Overall P0–P6 completion is now **35%** (10.5/30 weighted gate units: P0, P1, P3
passed). PKG is still deferred; inference stays disabled. The P3 gate covers
explicit unsupported-claim flags and conservative agreement, not truth certification.

Final positions now request `claims`, a bounded list of up to eight objects:

```json
{"id":"c1","kind":"assumption","text":"A small pilot can test demand.","evidenceIds":[],"snapshotId":null}
```

Kinds are `fact`, `assumption`, or `proposal`. Factual claims without references,
unknown/ambiguous IDs and missing/wrong snapshot revisions are flagged unsupported.
Resolvable references are labeled `reference-valid-unverified`: even a valid
citation can fail to support its claim. Assumptions remain unresolved. Supplied
context and peer repetition are not independent evidence. No evaluator model is called.

The canonical outcome records claim coverage and every check, displayed in the UI
and Markdown report. Missing claim declarations remain readable but unassessed.
Malformed declarations invalidate the position; original response and usage remain
available. Existing saved outcomes and reports are not rewritten or re-certified.

Matching recommendation wording cannot yield `agreement` while claims/assumptions,
dissent, missing responses or differing rationale, risks, next steps or subsidiary
proposals remain unresolved. Majority recommendations remain attributed proposals.
Raw final response text is authoritative; cached parsed objects and duplicate
roster entries cannot manufacture votes.

Limits: the complete final response is capped at 12,000 characters. Claims have
unique IDs (40 characters), text up to 600 characters, up to five evidence IDs
(200 characters each), and snapshot ID up to 200 characters or null. The validator
does not exhaustively extract facts from prose or earlier rounds. An empty claim
list does not certify that a response contains no factual assertions.

Validation: 254 Node tests, 8 Python tests and TypeScript passed, including offline
engine persistence, read-only reopening, UI display and adversarial cases. No live
model tests, authentication or VM operations were performed.


### P4 call-bounded subscriptions — adopted controls

Set `MAX_SESSION_CALLS` to an integer from 1–9 (default 9). The effective session
cap is also bounded by providers × rounds. Each full round is reserved before
concurrent dispatch; insufficient remaining slots stop the session as partial,
without choosing an arbitrary subset of providers. Failed attempts consume slots.
The cap counts application adapter invocations, not hidden SDK/backend requests.

Optionally set `MAX_SESSION_TOKENS` to a positive integer (maximum 1 billion) to
require a **strict total input+output token ceiling**. The default is call-only
mode, with observational token accounting. Per-session API configuration:

```json
{"prompt":"Discuss an idea","budget":{"maxCalls":6}}
```

Clients may lower server limits, but cannot increase them or disable a server
token ceiling with null. Limits are validated and frozen when the session is
created. Strict admission requires a trustworthy `maxTotalTokensPerCall` adapter
guarantee covering all input, output, retained context and internal provider work.
**Current Codex, Claude and Grok Build subscription adapters do not expose this
guarantee, so strict-token sessions are refused before preparation or inference.**
Call-only subscription discussions remain supported. Deterministic mocks have a
zero-token bound; offline test adapters exercise nonzero reservations. Output caps,
prompt estimates, character counts and abort signals are not total-token bounds.

The ledger keeps reservations across parallel calls. Known input+output usage
releases unused capacity; cache and reasoning breakdowns are not added again.
Unknown/failed/timeout usage retains the full reservation, or a larger known lower
bound. A reported bound violation is flagged explicitly, preserves actual usage
and stops later rounds. Late results cannot refund a finalized reservation.
Cancellation and disposal still complete before the report is finalized.

The session API, audit events and Markdown report retain limits, admitted attempts,
charged and outstanding tokens, unknown-usage counts, breaches and denial reasons.
Older saved sessions retain their original reports and have no invented budget
state. `MAX_SESSION_USD` remains an advisory known-cost threshold, not a hard
monetary ceiling; unknown subscription costs remain unknown. No API-key fallback.

Validation: 284 Node tests, 8 Python tests and TypeScript passed. No live model
tests, authentication or VM operations ran; inference remains disabled and PKG
deferred. The user-approved P4 gate now covers call-bounded subscriptions with
explicit token accounting, and has passed offline. A hard provider-wide token
ceiling is not part of this revised gate and remains unavailable. Original phase
weights are unchanged; overall P0–P6 completion is **48.33%**. Historical research
entries below preserve their earlier status and are superseded by this update.

Reports label partial input/output sums as lower bounds, never treating unknown
usage as zero or claiming token-breach monitoring in call-bounded mode. Even fully
reported counters do not certify hidden backend work. Timeout bounds local waiting;
remote work may continue after cancellation. No hard token, USD, or SDK-retry cap
is implied. Existing strict-token settings still fail closed; to run a future
subscription discussion, omit `maxTokens` and leave `MAX_SESSION_TOKENS` unset.
This does not enable inference.


### Offline token-ceiling investigation — 2026-11-01

No verified total-token ceiling was established for the pinned subscription
runtimes; strict-token sessions still refuse dispatch. This does not establish
that every vendor version lacks the feature. Two candidates deserve further proof:

- **Codex 0.166.0:** no typed SDK total-budget option, but generic config forwarding
  and packaged-binary rollout-budget symbols (`enforce_limit`, `limit_tokens`,
  sampling/prefill weights). These are discovery hints, not verified semantics.
- **Claude SDK 0.3.316 / manifest CLI 2.1.316:** alpha `taskBudget.total` forwards
  `--task-budget`. Its local documentation describes model pacing via
  `output_config.task_budget`; total-token enforcement and subscription support
  are not established. `maxOutputTokens` in ModelUsage is metadata, not a query cap.
- **Grok Build 1.0.70:** cached docs expose completion/turn/retry controls, not a
  suitable invocation-wide budget. Global completion/retry settings are defaults
  subject to model overrides. Cached documentation is not proven tied to 1.0.70.

See [the investigation record](docs/IMPLEMENTATION_PLAN.md#provider-ceiling-findings--offline-2026-11-01)
and `runs/provider-token-ceilings-2026-11-01/evidence.json` for local source hashes
and excerpts. All 19 existing targeted budget/engine tests passed. No runtime code
or configuration changed, no CLI was launched, and no network/authentication/VM/
model tests ran. Inference stays disabled, PKG deferred, and unknown subscription
costs explicit. P4 remains open; entire-roadmap completion stays 35%.


### Enterprise login and deeper budget review — 2026-11-01

Enterprise subscription login is a conditional integration path, not yet verified
against your tenant. Start with organization-approved individual **Codex + Claude**
logins on a trusted local workstation. Confirm product seats, admin policy and
cross-provider data sharing. Before broader use, add isolated user profiles,
organization/workspace pinning and an identity-only preflight. Shared deployment
still requires P5 authentication, tenant isolation, DLP and audit controls.
Grok's cached guide documents customer OIDC, but the VM adapter currently uses
`grok.com` and does not configure custom enterprise OIDC. Keep that optional until
supported and verified. Subscription login remains mandatory; no API-key fallback.

Offline inspection found a Codex rollout-budget exhaustion path in the binary,
but the full pinned Rust source/schema is absent locally. Claude's packaged client
conditionally inserts/removes task budgets, and its local API fallback contract
permits attempts without one in specified cases. This does not prove our adapter
activates fallback, nor does it establish a hard raw-token ceiling. Strict-token
subscription sessions therefore continue to refuse dispatch; costs stay unknown
where the provider does not report them.

[Detailed findings and limitations](docs/IMPLEMENTATION_PLAN.md#pinned-enforcement-source-and-enterprise-assessment)
and `runs/enforcement-enterprise-review-2026-11-01/evidence.json` preserve the
local evidence. All **34 targeted offline tests passed**. No live tests or runtime
changes; inference remains disabled and PKG deferred. Overall roadmap: **35%**;
this investigation: **100%**, with full Codex-source proof still unavailable.


### Codex rollout budget: source verified

The exact 0.166.0 release source/schema is now archived and reviewed at commit
`6ff1e1ca3b30fc8b914720681fcf5fe62e95f856`. It implements a **post-response weighted
cutoff**, not a hard total-input-plus-output ceiling. Provider budget units override
its fallback calculation; the fallback excludes cached input. It charges usage
before reporting exhaustion, can overshoot, and lacks pre-dispatch reservations.
The SDK also launches a new CLI process per turn, so its in-memory budget must not
replace our durable discussion ledger.

Strict-token subscription sessions remain refused; no experimental switch was
enabled. [Source evidence and enforcement analysis](docs/IMPLEMENTATION_PLAN.md#codex-01660-source-backed-enforcement-decision)
distinguish static verification from live acceptance. All 34 targeted offline
tests passed. Inference stays disabled, PKG deferred, unknown costs explicit.
P4 remains open and the entire roadmap remains 35% complete.


### P5 protected review API — initial offline foundation

Historical first slice: optional OIDC browser support now extends this entrypoint;
see the enterprise/browser section below for current configuration.

`npm run start:secure` starts a separate **API-only**, loopback-bound service on
port 3031. `KOINOUS_SECURITY_CONFIG` must point to a trusted local JSON file:

```json
{
  "root": "/absolute/private/koinous-protected",
  "port": 3031,
  "principals": [
    {"subject": "alice", "tenant": "team-a", "tokenSha256": "<64 lowercase hex SHA-256 characters>"}
  ]
}
```

Provision each application access token from at least 32 cryptographically random
bytes encoded as base64url. Store only its SHA-256 digest in this config, protect
the config with owner-only permissions, and keep the raw token in the client's
secret store. Send `Authorization: Bearer <application-access-token>` on every
request, including health, reports and SSE. Query-string tokens and cross-origin
access are rejected. These tokens authenticate access to **Koinous**; they are not
LLM API keys. Provider authentication remains subscription-only. Tokens currently
have no automatic expiry; revoke/rotate by editing trusted config and restarting.
No application credentials were provisioned during implementation.

The CLI forces real-provider mode but **refuses all discussion creation** until
isolated per-user provider profiles are implemented, even if the global inference
flag is enabled. Health explicitly reports inference disabled. Offline tests use
injected mock adapters. This entrypoint is not yet a browser-login UI or enterprise
SSO integration; static UI routes are not served. The existing `npm start` remains
the unauthenticated, single-workstation UI and must not be exposed as the protected
service. No existing server was restarted or security configuration activated.

Protected storage must be outside the default legacy `runs` tree. Each tenant gets
its own engine and saved-record directory under `root/tenants/<tenant>`, derived
only from trusted configuration. All tenant members share their tenant's records;
request tenant headers/body fields grant no access. Legacy sessions are not
imported or scanned. Keep this root out of every legacy server's custom output
scan as well. This is application-level isolation, not protection from a malicious
local process running as the same OS user or from a host administrator.

DLP rejects detected private-key markers, common provider/GitHub/AWS token forms,
bearer credentials and SSN-shaped identifiers. It checks decoded request bodies
(including context, models and interventions), composed provider prompts and
returned reply metadata/text. Detected replies are withheld from persistence and
peer exchange; numeric usage remains accounted for. Provider error messages and
identifiers are withheld, with safe numeric usage retained. Detection is a bounded
pattern baseline: it can have false positives and misses obfuscated secrets,
other PII and organization-specific confidential content. It does not certify
that arbitrary data is safe to send to a provider. PKG grounding is blocked here.

`security-audit.jsonl` records server-owned subject/tenant, route category, optional
session UUID, decision/reason, sequence, timestamp and hash-chain links. It excludes
request/response content, search strings, tokens and raw exception text. An allow
record means **authenticated access attempted**, not successful data access or a
completed mutation; tenant-local lookup can still return 404. DLP blocks are logged
separately. Records are fsynced before access; malformed chains, external changes,
write failure or a log above 4 MiB fail closed. Directory mode is 0700 and audit
mode 0600; symlink roots/files are rejected. An exclusive `security.lock` prevents
a second writer for the same root; orderly shutdown removes it. After a crash,
confirm no process uses the root and preserve/verify the audit before removing a
stale lock. Do not automatically delete locks or reset corrupt audit files.

Audit history is not externally anchored or cryptographically signed; an operator
can rewrite it offline or truncate it before restart. Remote immutable export,
retention/rotation, response-outcome auditing, quotas, RBAC, enterprise SSO/browser
sessions, encryption at rest and per-user provider-worker isolation remain P5 work.
No shared deployment or production-security claim is made.

Validation: **294 Node tests, 8 Python tests and TypeScript passed**, including ten
new security tests. Evidence: `runs/p5-security-foundation-2026-11-01/check.log`.
Inference remains disabled, no API-key fallback was introduced, and PKG is deferred.
Overall roadmap remains **48.33%**; this foundation is complete but P5's full
pilot-security/deployment gate remains open.


### P5 enterprise identity and browser sessions — offline validated

The protected entrypoint now supports optional enterprise OIDC sign-in and the
existing saved-discussion review UI. Add an `oidc` object to the trusted JSON
referenced by `KOINOUS_SECURITY_CONFIG`; `principals` may be omitted for browser-only
access. Existing provisioned bearer principals remain optional API clients.

```json
{
  "root": "/absolute/private/koinous-protected",
  "port": 3031,
  "oidc": {
    "issuer": "https://your-approved-issuer.example/tenant",
    "authorizationEndpoint": "https://your-approved-issuer.example/tenant/authorize",
    "tokenEndpoint": "https://your-approved-issuer.example/tenant/token",
    "clientId": "your-registered-public-client-id",
    "jwks": {"keys": [{"kty": "RSA", "kid": "approved-key-id", "alg": "RS256", "n": "<public modulus>", "e": "AQAB"}]},
    "members": [{"issuerSubject": "exact-provider-subject", "subject": "alice", "tenant": "team-a"}]
  }
}
```

Register a **public client** supporting authorization code + S256 PKCE with the
exact redirect URI `http://127.0.0.1:3031/auth/callback` (adjust the configured port).
Use the issuer's exact identifier and approved endpoints; both endpoints must be
HTTPS on the issuer's origin. Supply approved **public** RS256 signing keys; private
keys are rejected. There is no discovery, token-selected key URL, automatic key
rotation, confidential-client secret or refresh-token flow. An operator updates
pinned keys/memberships and restarts to apply changes. Your IdP must permit this
public-client/loopback configuration; tenant compatibility is not yet live-tested.
No actual issuer, client registration, credential or membership was configured.

Open `http://127.0.0.1:3031/` after separately starting the protected service. The
public page offers enterprise sign-in. Success opens the authenticated review UI
with a sign-out button. The browser helper keeps CSRF material in memory; it uses
no local/session storage for identity tokens. Cookie-authenticated fetch, report
links and EventSource share the server session. Inference remains blocked in real
mode even after login, regardless of the global opt-in. Enterprise app identity
never substitutes for an LLM provider subscription login or its tenant entitlement.

Identity checks use pinned `jose` **6.2.14** for signature/claim verification:
RS256 only, exact issuer/audience, expiry/issued-at age, authorized party when
applicable, nonce, and explicit issuer-subject membership. State is single-use,
bound to a separate browser transaction cookie, and expires after five minutes.
The exchanged ID token is transient; access/refresh tokens are not used or stored.
Email/domain/group/tenant claims never grant membership automatically. The design
was checked against [OIDC ID-token validation](https://openid.net/specs/openid-connect-core-1_0.html#IDTokenValidation);
this is not a claim of OIDC certification or broad enterprise-provider compatibility.

Session IDs are random opaque cookies, HttpOnly, SameSite=Lax, host-only and Path=/.
Server-side records store hashes of session IDs and expire after ten minutes idle
or thirty minutes absolute, capped by ID-token expiry. Login replaces the previous
browser session; logout and restart revoke it. Logout/expiry close registered event
streams. Pending logins and sessions each have a 100-record cap. Identity-provider
exchange uses a ten-second deadline, rejects redirects and bounds response size.

**Local-only boundary:** cookies intentionally use HTTP on the canonical loopback
host and therefore do not have the Secure attribute. They are not scoped by port;
other services running as the same trusted workstation user are outside this
boundary. `localhost` aliases, forwarded-host headers and remote deployments are
not supported in OIDC mode. Do not expose this listener through a remote proxy.
A remote enterprise deployment requires approved HTTPS, Secure cookies and a
separate trusted-proxy/origin design. This slice does not relax TLS to the IdP.

Every cookie-authenticated mutation requires the exact canonical Origin and
`X-CSRF-Token` for that session. The only cross-site navigation exception is the
GET login callback, protected by state/nonce/PKCE/browser binding. Duplicate cookies,
replayed callbacks, unsigned/wrong-key tokens, unenrolled subjects and ambiguous
cookie+bearer authentication fail closed. Login failures expose only generic errors;
audit entries contain local identity metadata, never codes, ID tokens or cookies.
Logout ends the Koinous session, not the IdP's own SSO session. Revocation at the IdP
is not pushed to this in-memory store; restart or local logout revokes local sessions.

Validation: **306 Node tests, 8 Python tests and TypeScript passed**, including
12 new identity/browser tests using generated fixture signing keys, fake token
exchange and a browser-helper VM harness. No live IdP, browser-to-IdP, provider or
model test ran. No service was launched/reconfigured. Evidence:
`runs/p5-browser-identity-2026-11-01/check.log`.
Full P5 remains open for per-user provider-worker isolation, authorization roles,
remote deployment/TLS, audit export/retention and tenant acceptance. Overall
roadmap remains **48.33%**; inference is disabled and PKG remains deferred.


### P5 per-user subscription profiles and restricted inspection workers

Optional `workerProfiles` entries in the protected configuration assign one login
namespace to each **local tenant + local subject + provider**. The owner must
already exist in configured bearer principals or OIDC members. For example:

```json
"workerProfiles": [
  {"tenant": "team-a", "subject": "alice", "provider": "codex"},
  {"tenant": "team-a", "subject": "alice", "provider": "claude"},
  {"tenant": "team-a", "subject": "alice", "provider": "grok"}
]
```

Configuration accepts only these three fields; client-supplied paths, environment
variables and owner overrides are rejected. Configured profiles are created under
`<protected-root>/credential-profiles/<tenant>/<subject>/<provider>/` with a private
owner record, `home/`, `workspace/` and `tmp/`. Directories must remain mode 0700;
the owner record must remain a regular, single-link, mode-0600 file matching its
configured owner. Symlink namespaces and changed ownership fail closed. There is
no automatic reuse, import or copying of host HOME, Codex, Claude or Grok logins.

Each inspection worker has a fresh process and an allowlisted environment built
from its own profile, never merged with the server environment:

| Provider | Explicit login location | Credential metadata inspected |
|---|---|---|
| Codex | `HOME=home/`, `CODEX_HOME=home/.codex` | `auth.json` presence/type/mode/link count/size |
| Claude | `HOME=home/`, `CLAUDE_CONFIG_DIR=home/.claude` | `.credentials.json` presence/type/mode/link count/size |
| Grok Build | `HOME=home/`, `GROK_BUILD_AUTH_HOME=home/.grok` | `auth.json` presence/type/mode/link count/size |

The worker **does not read credential contents**, log in, contact an IdP/provider,
load an SDK or send a prompt. It reports `credentialFilePresent` separately from
`authenticationVerified:false`. File presence is not proof of valid login,
entitlement, account identity, or support for the provider's OS-keychain storage.
No operational credential profile was populated or migrated during development.
Authentication/refresh and provider SDK access to OS-keychain storage require subsequent work.

Authenticated inspection endpoints:

- `GET /api/worker-profiles`: list only the current subject's configured providers,
  without paths or credential metadata.
- `POST /api/worker-profiles/<provider>/preflight` with `{}`: run a metadata-only
  inspection for that exact owner/provider. Cookie clients require the existing
  Origin/CSRF checks. Additional body fields are rejected; same-tenant users cannot
  choose each other's profiles.

Workers use the current absolute Node executable (Node 26+ required; validated on
26.12.1), `--permission`, read access to their own profile and the trusted worker
script only, and no filesystem-write, network, child-process, addon or worker-thread
grants. The worker actively checks outside-profile directory access, child spawning
and network denial before returning success. Node's permission model remains a second layer inside the mandatory macOS
Seatbelt boundary described below. Inspection acceptance does not authorize
provider SDK execution or prove production tenant isolation.

Each preflight has a five-second deadline, bounded input/output, one active process
per profile and at most eight total. Abort/timeout/shutdown kill and await the direct
child's exit. No descendants are permitted. Credential directories persist and are
not deleted on preflight completion; no credential copies or temporary files are
created. Outputs are reconstructed from approved boolean/status fields, and raw
stdout/stderr errors are not exposed. Audit records contain owner/provider and
inspection outcome, never credential contents or paths.

Real inference remains blocked in the protected service, including when profiles
exist, a preflight passes, or the global inference opt-in is set. No API-key fallback
was introduced. Existing workstation adapters and the Grok VM sandbox are unchanged;
no VM was created. SDK-running workers, per-provider OS sandbox policy, keychain
restrictions, credential refresh and tenant account verification remain pending.

Validation: **315 Node tests, 8 Python tests and TypeScript passed**, including nine
new profile/worker tests. Actual local restricted subprocesses inspected synthetic
fixtures only; network probes were denied by permissions and no model/authentication
calls occurred. Evidence: `runs/p5-profile-workers-2026-11-01/check.log`.
Both inference flags remain 0. PKG remains deferred. This foundation is complete;
full P5 remains open and overall roadmap completion remains **48.33%**.


### P5 OS confinement for profile inspection

`ProfileWorkers.inspect` now always launches through `/usr/bin/sandbox-exec` with
a deny-default Seatbelt policy, then applies the existing Node permission flags.
Unsupported platforms, unavailable sandboxing, policy compilation/startup failures
and denied runtime dependencies fail closed. There is no unsandboxed retry or
API-key fallback. This is the inspection boundary for all three provider profiles;
provider SDK execution remains blocked in the protected service.

The OS grants reads for the exact worker script, owner record and workspace directory,
plus runtime executable/libraries and Apple's dynamic-loader bootstrap rules.
Profile contents receive metadata access only: even the owning profile's credential
contents are denied. Writes, process creation, network sockets and Mach service
lookups have no grants. The initial exec is limited to the current Node executable;
process forking remains denied. No shell is used. Only stdio pipes are passed.
Existing timeout, cancellation, output bounds and shutdown/reaping still apply.

The trusted parent derives exact non-system library files from Node's loaded runtime
report; it never prints or saves that report. Libraries receive read/map permission,
not directory-wide content access. Homebrew symlink metadata, runtime directory
metadata, system libraries, read-only sysctls and Apple's `dyld-support.sb` are
necessary bootstrap exceptions. An explicit empty OpenSSL configuration prevents
loading ambient host configuration. No general `system.sb` profile is imported.
The launcher and runtime installation must be administrator-controlled in deployment;
this does not protect against an administrator or an attacker controlling the parent
process, runtime files or OS policy files. No parent application sockets are inherited.

Offline tests exercise the actual kernel policy **without Node permissions** in a
synthetic probe, independently confirming owner-record access, credential stat,
credential-content denial, cross-profile read/list denial, symlink escape denial,
write denial, child-process denial, TCP connect/listen denial and Unix-socket denial
against an existing local fixture socket. Production workers retain both layers.
Mach/keychain access is denied by policy; no real keychain or login was contacted.
Other tests verify protected API owner selection, cancellation and inference refusal.

Validation requires macOS with functional `sandbox-exec` and Node 26+. A runner that
prohibits nested Seatbelt application must run the offline suite in an authorized
host context; never skip the OS layer to make tests pass. The macOS private policy
interface can change across OS upgrades, so rerun the offline gate after runtime/OS
updates. No cross-platform support or hostile SDK execution is claimed by this gate.
The existing Grok guest VM policy and managed cleanup remain unchanged. Future SDK
workers need provider-specific filesystem/refresh and constrained egress policies,
independent escape tests, and separately authorized identity-only acceptance.

### P5 SDK execution preparation and restricted egress

The protected service now exposes authenticated
`POST /api/worker-profiles/<provider>/sdk-preflight` with an empty `{}` body.
For Codex/Claude this **imports the pinned SDK inside Seatbelt**, returns its pinned
version and `authenticationVerified:false` / `inferenceEnabled:false`, and exits.
It does not run a CLI, authenticate, resolve provider DNS or send a prompt. Owner
selection, browser CSRF/Origin checks, bounded input and metadata-only audit apply.
Grok refuses this host path; its existing managed VM boundary is retained.

Execution preparation lives in `sdk-execution.ts`, `sdk-adapter.ts` and
`sdk-boundary.ts`. It verifies installed SDK/native-package versions, uses explicit
native CLI paths, creates a profile-only environment and preserves the adapters'
subscription login settings, text-only options and usage normalization. Codex
continues to report unknown USD; no API prices are substituted. SDK option tests
use injected fakes; real SDK imports are tested separately without login. Native
version/help startup now passes the separate check described below; inference
protocol and provider proxy compatibility remain unverified in this boundary.

The execution policy is distinct from the stricter metadata inspection policy:

- Read trusted application/SDK code and the exact native CLI; execute Node and that
  CLI only. No shell, arbitrary helper, OS-keychain service or workspace-write grant.
- When preparing execution, read/write only the owning login and temporary state
  directories. Import checks omit login-content permission. Cross-profile paths
  and symlink escapes remain denied; installation code must be administrator-owned.
- Permit fork/exec while denying the `setsid`, `setpgid` and `posix_spawn` syscalls.
  This blocks session/group escape, including spawn attributes. An SDK-worker-only
  spawn shim supplies the current uid/gid to select Node's validated fork/exec path;
  it rejects detached/identity-changing requests. Bypassing the shim does not bypass
  the kernel policy. Descendants inherit Seatbelt and stay in the supervisor's group.
- Permit outbound **IPv4 TCP only to the assigned broker port**, using `tcp4`.
  Kernel tests deny a reachable IPv6 listener at the same port, a reachable IPv4
  listener at another port, and an alternate loopback address. Direct internet,
  DNS, IPv6 and Unix sockets have no grant.

`WorkerEgress` is a per-worker CONNECT broker with a random capability, exact
administrator-supplied destination names and port 443 only. There are no default
provider destinations, suffix wildcards, client-supplied host lists or API keys.
It rejects duplicate/missing/wrong-worker proxy authentication, ordinary HTTP,
malformed authorities and pipelined initial bytes before DNS. All resolved IPv4
addresses must be public; IPv6 and special/private ranges fail closed. It connects
to the validated literal address, avoiding a second DNS lookup. The local proxy
capability is never an HTTP API response or audit field.

Limits are 32 CONNECT attempts, 16 tracked sockets (clients and upstreams combined),
16 MiB aggregate payload, a 120-second broker lifetime, five-second connection/header
waits and fifteen-second tunnel idle limits. Cancellation, expiry and byte exhaustion
revoke active sockets and reject new traffic while retaining the IPv4 listener as
an endpoint lease. The trusted owner must await process-group teardown before final
`close()` releases that lease; it must not release a port while a worker can still
connect. Late DNS work cannot dial after revocation. Tests use
injected resolvers/dialers and synthetic local peers only, including forwarding,
byte-limit closure and cross-worker capability rejection.

This is a destination-level TCP tunnel, **not TLS termination or HTTP-content DLP**.
It does not inspect encrypted paths/methods, prevent virtual-host fronting on a
shared allowed IP, or independently validate client TLS identity. The future live
allowlist must be reviewed against subscription endpoints and organization policy;
no real endpoint list or credentials were configured here.

`SDKWorkers.run` remains unconditionally disabled, even if the global inference
flag is changed. The worker's run protocol is prepared behind a separate environment
gate, but the parent never enables it in this release. Protected session creation
still returns its existing isolation-pending denial. Import success is not execution,
authentication, entitlement or tenant-pilot acceptance. Before live dispatch, finish
TLS/content policy, resource quotas, account pins and Grok guest egress, then
validate the native SDK/CLI execution contract offline.
Any subsequent live authentication/model test needs separate user authorization.


### Descendant containment verification and operations

`confinedProcess` creates the worker process group before Seatbelt applies, then
signals that entire group on abort, timeout or root exit and awaits pipe closure.
The shared supervisor is used by SDK import checks. Native offline fixtures first
prove that unconfined `setsid`, `setpgid`, `POSIX_SPAWN_SETSID` and
`POSIX_SPAWN_SETPGROUP` work, then require EPERM under the actual production policy.
They double-fork an orphaned grandchild and verify the original group remains intact
and no member is runnable after cancellation, timeout or normal root exit. A zombie
awaiting OS reaping is distinguished from a runnable survivor. Fixture alarms are
an independent cleanup backstop, not part of the production containment mechanism.

The kernel policy also denies ordinary posix_spawn. The worker's compatibility shim
uses an explicitly same-user fork/exec path verified on Node 26.12.1/macOS arm64;
unsupported spawning fails closed. Native provider CLIs that need posix_spawn may
therefore require additional integration work. Do not remove the syscall denials
to make a CLI start. The real SDK/CLI execution contract remains an offline follow-up.
No native provider CLI, real login, model request or VM was used for these tests.

`npm run check` now compiles a small native fixture with `/usr/bin/clang`, so macOS
Command Line Tools are required for this gate. Runtime/OS upgrades require rerunning
these escape tests. The application still needs deployment-level process/memory
quotas and trusted supervision: the tests do not claim containment after the trusted
supervisor itself is killed or against an administrator/kernel compromise. TLS
inspection and encrypted virtual-host fronting remain outside the CONNECT broker's
present contract. Inference remains disabled; inspection success cannot enable it.

### Native CLI startup compatibility (offline)

`SDKWorkers.inspectNative(profile, signal)` checks pinned Codex/Claude `--version`
and help output through the confined SDK worker and its same-user fork/exec shim.
Codex uses `exec --help`; Claude uses `--help`. Arguments are fixed, with no request
path/env/argv override. It does not create a session, check account status, log in,
refresh credentials or invoke inference. The existing HTTP `sdk-preflight` remains
import-only; native startup is a separate deployment/test method.

The result includes the pinned CLI version, `startupOnly:true`, version/help checks
and `stderrObserved`. Native output and diagnostic paths are not exposed. Codex
currently emits a warning because home/PATH-alias access remains denied; it still
passes these harmless startup commands. This is not proof that its inference path
or subscription login will work. Claude requires system ICU locale data: its policy
now allows only exact root-owned, non-symlink, non-group/world-writable ICU data
files. Filesystem, credential, network and process-escape restrictions remain.

Each command is bounded to two seconds and 64 KiB combined output; the outer worker
retains its deadline, capacity and group cleanup. Tests verify real startup with
synthetic profiles unchanged, command and version failures, forbidden protocol
fields, cancellation and inference refusal. Native provider network/protocol and
Grok guest integration still require subsequent work. See the P5 closure checklist
in `docs/IMPLEMENTATION_PLAN.md` for the remaining pilot gates and revised estimate.


### Offline SDK/CLI protocol integration

The pinned Codex and Claude SDKs now have confined integration tests against
synthetic executable CLI peers. They cover initialization, prompts, three sequential
calls (including Codex resume), errors, malformed/empty output, missing usage and
hung-process cleanup. The fixture processes receive synthetic profiles, no credential
contents, no network grants and no API-key environment variables. Production
inference and protected dispatch remain disabled; these tests do not verify login,
entitlement or live model compatibility.

Failed worker replies retain validated token counters and explicit unknown cost
while excluding SDK diagnostic text, paths and IDs. Provider cost estimates retain
their estimate label and are not subscription charges. Supervisor deadlines and
cancellation have distinct error codes and still kill the entire process group.
The outer deadline is necessary for stalled SDK calls; no sandbox permissions were
relaxed. Partial-answer EOF is now rejected at the prepared confined SDK boundary (see below).

Acceptance: 365 Node tests, 8 offline Python guest tests and TypeScript passed.
See `docs/IMPLEMENTATION_PLAN.md` for evidence and remaining R1–R5 pilot gates.


### Partial output and terminal validation

The prepared confined Codex path consumes SDK events directly and requires a
`turn.completed` event before publishing text. Claude requires a terminal `result`;
its adapter still checks that the result succeeded. Both withhold answers until the
SDK-visible stream finishes, reject duplicate terminal events and post-terminal
messages, and preserve available terminal usage when a later error occurs. Partial
assistant text is never returned as a completed answer or copied into error details.
Absent usage/cost stays unknown; reported estimates are not subscription charges.

Offline tests exercise actual pinned SDKs against synthetic CLI partial EOF, Codex
failure after partial text, duplicate completion and nonzero exit after completion.
Injected SDK streams additionally cover malformed terminal data, cancellation and
trailing errors for both providers. This validates events/errors exposed by the SDK,
not raw CLI bytes that an SDK might discard. It adds no retry, authentication or
model call. Subscription-only options and OS restrictions are unchanged; inference
and protected dispatch remain disabled. Legacy direct adapter entry points and
Grok ACP are outside this confined-boundary slice.

### Credential-scoped worker lifecycle

`CredentialWorkers` resolves a profile from the authenticated tenant/subject and
provider, rather than accepting a caller-supplied path. An atomic `worker.lease`
directory prevents concurrent use across manager instances and processes. Each
worker gets fresh private scratch; persistent subscription login files remain in
the owner's existing profile and are not copied into scratch. Ownership is checked
again after preparation and before launch. Supported host providers are Codex and
Claude; Grok continues to require its separate guest boundary.

Cancellation, deadline and shutdown stop the owned process group. Cleanup awaits
process settlement, closes the broker (retaining its port until teardown), removes
scratch, then releases the profile lease. Cleanup failure retains a blocking lease.
A stale lease after a crash requires an operator to verify no worker survives and
inspect leftover scratch before removing it; it is never automatically stolen.
This is not secure erasure, at-rest encryption or supervisor-death containment.

The launcher/preparation driver is trusted deployment/test wiring, never request
input. It must return a process handle whose `done` settles after group teardown;
preparation must honor cancellation and clean up its own resources if it throws.
The default driver is absent and refuses execution. No protected API invokes this
path and `SDKWorkers.run` remains disabled. Offline tests inject confined synthetic
processes and synthetic login files; no operational credentials, authentication,
provider network or inference are used. Scope and remaining R1–R5 gates are in the
implementation plan.


### Grok guest network and cleanup gate

The guest now uses bubblewrap `--unshare-net` with no outbound interface or proxy.
An empty allowlist selects `deny-all`; a nonempty trusted allowlist selects the
restricted broker described below. There is no shared-network fallback. Managed preparation requires both a distinct network namespace and only
loopback interfaces, alongside the existing filesystem/process checks. The probe
checks namespace/interface state without contacting any remote address.

**Current consequence:** an empty allowlist blocks authentication and model traffic.
The restricted route below is implemented and tested offline; Linux namespace/bridge
verification also passed with synthetic endpoints. Pinned Grok CLI proxy use and cached subscription authentication also passed the
bounded check below; model traffic remains untested through this revised route. Historical
live runs do not establish readiness of the revised runtime.
No provider test is authorized by this documentation.

Guest cleanup kills/reaps the child before deleting its credential tree. Unconfirmed
kill/reap or deletion errors fail closed, leaving evidence for managed VM destruction.
The host audit distinguishes credential absence observed (true), observed remaining
(false), and unknown (null). Independently verified owned-VM absence is the final
cleanup gate. Failed inventory verification retains the ownership lock/staging;
concurrent disposal shares one operation, with retry possible after a failed teardown.
Offline evidence uses mocked launch/VM commands; it does not certify Linux kernel
namespace enforcement. No VM, real credential or provider request is used by the tests.


### Restricted Grok guest outbound connectivity (offline implementation)

The trusted deployment setting `GROK_BUILD_EGRESS_HOSTS` is a JSON array of exact,
lowercase DNS hostnames. Its default is `[]` (deny-all). There are no built-in provider
destinations: operators must approve the required subscription-login/model hosts.
Wildcards, IP literals, URLs, ports and duplicates are rejected. This setting is
never taken from discussion input or a browser request. Managed connections freeze
an independent copy; explicit connections do not inherit ambient egress settings.
No local deployment allowlist or inference flag was enabled by this change.

With approved hosts, the guest starts a private Unix-socket CONNECT broker outside
the sandbox network namespace. Only that invocation's socket and read-only helper
are mounted inside. A loopback HTTP proxy inside the namespace forwards to this
socket and sets HTTP(S)_PROXY for the child, with NO_PROXY empty. `--unshare-net`
remains mandatory. A CLI that ignores proxy settings has no direct outbound route;
there is no fallback to shared networking, API keys or an unrestricted proxy.

The broker accepts only canonical CONNECT requests to approved-host:443. It rejects
ambiguous headers, extra/pipelined bytes, other methods/ports/hosts, IP literals,
private/reserved/multicast or mixed-public/private DNS results and IPv6. It resolves
IPv4 once and connects to the validated numeric address, avoiding a second DNS
lookup. TLS remains end-to-end; this controls destinations, not encrypted content,
URL paths or provider entitlement. Organization DLP/content controls remain R3.

Limits: 4 KiB request headers, 32 connection attempts, at most 16 tracked sockets,
16 MiB total tunneled data and a 120-second maximum invocation lifetime. Header,
connect and I/O operations have bounded waits. A late DNS result after revocation
cannot dial. Teardown revokes connections before worker termination, closes the
broker after the reap attempt and retains credential evidence if reap fails. The
Unix socket is private (0600 inside a 0700 invocation root); failed broker startup
removes it, and repeated close cannot remove a newer invocation's socket.

Tests run actual local Unix/loopback tunnel code with injected DNS and socketpair
upstreams, plus mocked guest launch/VM commands. No external DNS, provider request,
VM provisioning, live login or model call occurs. Linux namespace/mount enforcement
passed the synthetic infrastructure check below; pinned Grok CLI proxy use and cached
authentication also passed the separately authorized check below;
protected dispatch and inference remain disabled until their acceptance gates pass.


### Linux infrastructure verification (synthetic endpoints only)

The authorized 2026-11-01 Linux run passed using the approved image and the managed
lifecycle. `scripts/grok-proxy-infra-preflight.ts` requires both inference flags 0,
overrides authHome with an unused fixture path and always disposes its VM. Its probe
keeps the production bubblewrap/bridge arguments but replaces Grok with Python.
The only upstream is a VM-local loopback echo endpoint behind injected synthetic DNS
and connector functions; there is no external DNS, authentication or model traffic.

Both normal cleanup and a simulated transport disconnect passed. Evidence confirms
network namespace isolation, loopback-only interfaces, direct IPv4/IPv6 denial,
private DNS/unapproved host/port/IP denial, Unix-socket bypass denial, allowed tunnel
byte transfer, active tunnel revocation and removal of sockets/credential roots.
All existing filesystem sandbox checks passed. VM removal and empty final inventory
were independently verified. Evidence: `runs/r1-linux-proxy-2026-11-01/verification.json`.

This establishes the Linux namespace/mount/bridge behavior for these synthetic
conditions. It does not establish provider DNS endpoints, TLS/login behavior or the
pinned Grok CLI's proxy compatibility: Grok was never executed in that infrastructure
run. The separate authentication-only acceptance below covers cached login and CLI
proxy use; protected dispatch and inference remain disabled.


### Pinned Grok proxy and subscription authentication acceptance

The 2026-11-01 authentication-only run passed with Grok Build 1.0.70 in the disposable
isolated VM. The protocol guard sent only initialize/authenticate with grok.com;
there was one authentication request and zero session/model requests. Both inference
flags stayed 0. The restricted broker observed one successful TCP connection and
7,169 tunneled bytes to cli-chat-proxy.grok.com, establishing actual CLI proxy use
alongside successful cached-login authentication. No API-key fallback was used.

The run-scoped exact-host allowlist was derived from the pinned executable:
grok.com, accounts.x.ai and cli-chat-proxy.grok.com. It excluded api.x.ai and did not
change .env. The broker reported 22 socket attempts overall; the other attempts are
not classified by the aggregate counters, and no causes or successes are inferred.
Diagnostics retain only numeric counters and allowlisted hostnames, never credentials,
headers, TLS content or authentication payloads. This is not model-entitlement or
enterprise-identity acceptance.

Source credentials were unchanged, guest credentials and staging were removed, and
VM removal was independently confirmed with an empty inventory. Evidence:
`runs/r1-proxy-auth-2026-11-01/verification.json`. R1 engineering checks are complete;
R2–R5 remain, and pilot dispatch/model testing still needs its separate gates.

### Current local provider configuration and offline Grok diagnostics

The local `.env` selects `KOINOUS_PROVIDERS=codex,claude` and disables Grok for new
app discussions with `KOINOUS_DISABLED_PROVIDERS=grok`. Both
`KOINOUS_ENABLE_INFERENCE` and `GROK_BUILD_ENABLE_INFERENCE` remain `0`.
`npm start` and `npm run start:secure` now load `.env` if present (existing shell
variables take precedence). Restart an already-running app to load this config.
Mock mode remains available without model calls. Subscription-only routing and
at least two participants are unchanged. Enterprise hardening and PKG are deferred.

Grok replies/errors now carry optional `grokDiagnostics` alongside `protocolTiming`.
It contains only version, three activity counts (public-message chunks, thought
chunks and matching-session extension notifications), and the latest observed
proxy counters. Notification count does **not** assert a retry: the extension
payload is neither interpreted nor retained. Counters saturate at 2,147,483,647.
No text, IDs, hosts, URLs, credentials, raw errors or TLS data enter the metadata.

Proxy categories are accepted sockets, attempt-limit rejection, concurrency-limit
rejection, header rejection, destination-policy rejection (`host`), DNS/public-IP
validation failure, dial failure, lifetime expiry, byte-limit rejection, tunnel I/O
failure and established tunnels. Categories are observations, not a complete
partition of accepted connections; cleanup can interrupt an operation. Existing
32-attempt, concurrency, lifetime, byte and destination limits remain unchanged.

The trusted guest wrapper emits at most 120 periodic snapshots (at least one second
apart) plus one shutdown snapshot. Each frame is below 1024 bytes and written
nonblocking; dropped diagnostics never obstruct cleanup. CLI stderr stays discarded.
The host validates the exact fixed schema, monotonic counters and bounded lines,
accepts at most 122 frames, and ignores malformed/oversized frames. Native CLI stderr
cannot supply proxy frames. Snapshots are immutable and attached synchronously on
abort so the outer timeout can persist them. `proxy: null` means no valid sample,
not zero denials. Persisted diagnostics describe the latest sample at terminal
response/abort, not a guaranteed final teardown tally; shutdown-only observations
may be unavailable. Missing snapshots and subscription costs remain unknown.

Offline coverage exercises synthetic proxy rejection, backpressure, frame abuse,
redaction, session matching, deadline persistence and saved reopening. No live
Grok compatibility or inference success is established by these tests.
