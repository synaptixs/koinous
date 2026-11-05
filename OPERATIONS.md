# Local evaluation and operations

This playbook covers one trusted workstation and P6 evaluation. It does not deliver
enterprise deployment, corporate account verification or PKG integration. Use only
provider login for cloud models; no API-key fallback. Local Ollama requires no
login; Ollama Cloud uses `ollama signin` through the workstation daemon. See
[Ollama setup](DEMO.md#ollama-local-and-cloud). The P6 evaluation harness remains
scoped to its existing approved OpenAI/Claude arms; new picker options do not expand
benchmark authorization. Grok stays off. Saved product sessions and
original validation policy are never edited by evaluation. Start from the clean
revision under review in an isolated checkout with `npm ci`; preserve other work.
Node >=22.10 is required; exact installed SDK/compiler versions must match package.json.

## Offline acceptance (no authentication or inference)

From the repository root:

```sh
export KOINOUS_ENABLE_INFERENCE=0
export GROK_BUILD_ENABLE_INFERENCE=0
npm run check
node --experimental-strip-types scripts/evaluate.ts preflight evaluation/example-config.json runs/p6-preflight-NEW
node --experimental-strip-types scripts/evaluate.ts mock evaluation/example-config.json runs/p6-mock-NEW
```

Each output directory must be new. The example models are explicit **mock placeholders**,
not approved live IDs. Mock runs prove plumbing only. `tests/evaluation.test.ts` exercises
missing dependencies in an isolated directory without node_modules, bounded baseline
calls, provider errors, timeout, cancellation, missing usage, invalid output, cleanup,
blinding, and read-only reopening of a discussion. Existing `engine-lifecycle`,
`engine-budgets`, `provider-runtime`, `saved-sessions`, and API/SSE tests cover the
production paths; full `npm run check` is the required gate. Sandbox/loopback tests
may require execution outside the outer tool sandbox; never weaken application controls.

Open `dashboard.html` locally for operational counts, latency and usage. It is
self-contained and fetches no scripts/styles/assets. `metrics.json` includes planned
versus completed cells; records include original results, validation, failures,
requested/reported models and counters. No quality scores are inferred from agreement.
Review `evaluation/PROTOCOL.md` and fixture checks before authorizing live work.

## Concrete live authorization gate

1. User chooses **two exact eligible model IDs**: codex/codex-2, or codex/claude.
   Confirm the intended corporate subscription workspace through approved login UI;
   do not read or print credential files. Existing login alone does not establish
   workspace identity. Authentication-only checks must not send a prompt.
2. Copy example config outside the checkout; replace models and choose one split.
   Keep the source checkout clean and committed. Run offline `preflight` on that
   exact config into a new directory. Review its manifest and offline evidence.
3. Present manifest hash, revision, model roster and cap to the user. Development:
   2 tasks × 16 = **32 attempts**. Heldout: 4 × 16 = **64 attempts**. No repeats.
   Combined ceiling is 96 only if both splits are explicitly authorized. Provider
   tokens, hidden retries and charges have no hard ceiling; disclose this before approval.
4. After explicit approval, an operator records `{ "authorized":true,
   "approvedBy":"actual user", "accountEligibilityConfirmed":true,
   "preflightEvidence":"reviewed evidence path", "protocolHash":"exact hash",
   "maxCalls":32 }` outside the checkout. Use 64 for heldout. Do not manufacture
   approval or eligibility. The file records approval; it is not an access-control system.
5. Only then set `KOINOUS_ENABLE_INFERENCE=1`, leave Grok at 0, and invoke
   `node --experimental-strip-types scripts/evaluate.ts live CONFIG NEW-DIR AUTHORIZATION`.
   The runner checks clean source and exact manifest hash before constructing adapters.
   It never initiates login. Unset inference immediately afterward.

The script pins 120-second deadlines, six discussion calls, no research, no automatic
retry, and Claude's $0.50 per-call SDK setting. Unset deadline, token-cap, session-USD
and provider-workdir overrides; conflicting settings refuse. Optional `codexReasoningEffort` (for example `"medium"`) is forwarded to all
OpenAI participants and recorded in the manifest/hash. Omission preserves SDK
defaults; Claude defaults are unchanged. Requested effort is not proof of equal compute. Installed SDK mismatches refuse.
Any source/config/runtime-version change invalidates the preflight hash.

## Stop, preserve, recover

Ctrl-C/SIGTERM requests cancellation, stops new cells and writes available metrics.
On a discussion provider failure, the product aborts remaining active calls and
stops subsequent rounds. Remote work may continue after local abort/deadline, so
missing usage is unknown. Never immediately retry to hide a failure. Cleanup failures
require recovery before another attempt. An uncatchable process kill can leave a
partial events file: preserve it, mark the attempt incomplete, and inspect it read-only.
Do not reopen partial files as complete sessions or invent missing terminal events.

Keep `manifest.json`, `prompts.jsonl`, cell event/result files, `results.jsonl`,
`metrics.json`, `fatal.json` when present, and review records. Fatal setup/measurement
errors invalidate comparisons; provider failures under valid setup remain outcomes.
Diagnose offline, record affected arms and correction, then obtain fresh authorization
before another model-spending attempt. Never reuse an output directory. Do not kill
unrelated processes. No automatic recovery authenticates or dispatches inference.

To review a completed discussion in the existing saved-session UI, use its recorded
UUID in the normal history interface. Evaluation baseline cells intentionally are
not product sessions. Disconnecting a UI viewer does not cancel an engine run;
reopen the saved UUID after completion. Existing SSE/reopen tests guard that behavior.

## Blind review and results

Give each of two independent reviewers only `review/packets.json` plus the protocol.
Keep `private-key.json` and model metadata private until grades are locked. Collect
actual human JSON grade rows and run:

```sh
node --experimental-strip-types scripts/evaluate.ts grade RUN-DIR GRADES.json
```

This is offline. It writes a new `grades-report.json`, refusing overwrite. Grades
must be reasoned integers in range, with unique reviewer/packet pairs. Report all
planned task/arm cells, missing grades, reviewer disagreement, paired quality deltas,
failures, per-call and session latency, call counts and known/missing usage. Independent
arms run sequentially; discussion is concurrent. Only four heldout tasks means a
wide unknown generalization error: report per-task range and no superiority claim.
Follow the preregistered decision screen; a larger experiment needs fresh approval.

## Data handling and limits

Run directories are Git-ignored and newly created roots are mode 0700. Manifests and
private blinding keys are mode 0600. Parent-directory privacy remains the operator's
responsibility. Prompts and model output can be sensitive: do not commit credentials,
corporate transcripts or original saved responses. Use only supplied synthetic tasks
for this protocol. Sharing requires reviewing the exact files; keep blind keys away
from reviewers. Delete only the particular authorized run directory when retention
ends. Never delete historical source evidence to make a result appear cleaner.

Known USD is partial provider accounting, not a subscription invoice; Codex USD is
unknown. No API-price substitution. Cache/reasoning counters are breakdowns. Proposed
SLOs are not accepted or measured production guarantees. Empty/invalid answers and
missing coverage count as gaps, never consensus. No P2/P5 completion is implied.
