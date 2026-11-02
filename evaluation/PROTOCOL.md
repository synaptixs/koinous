# Koinous P6 protocol v1

Status: preregistered engineering protocol; **no empirical results yet**. This is a
small descriptive pilot, not a statistical proof that discussion is superior.
The original three-provider experiment is adapted to two explicitly selected OpenAI
models (codex/codex-2), or Codex plus Claude. Grok remains disabled. Distinct requested
IDs do not prove distinct underlying models. Report requested and reported IDs;
unknown reported IDs remain unknown. Corporate entitlement is separately unverified.

## Fixed design

`tasks.json` contains six public synthetic developer decisions: two development
and four heldout. Inputs contain all required facts. No private corpus, retrieval,
external citation or code execution is needed. Expected checks are independent of
any implementation and are never included in model prompts. Development is for
protocol/runner debugging, not selecting the best model. Do not tune prompts or
rubrics after inspecting heldout answers. Any amendment gets a new protocol version,
new authorization and a fresh matched attempt; preserve the old attempt unscored
if a setup defect invalidated it. These are decision tasks, not bug-fix tasks: there
is no known patch baseline. Rubric anchor tests cover known acceptable/unacceptable
answers independently of model execution.

Each task has five arms, each generated independently with fresh adapter instances:

| Arm | Calls | Returned candidates |
|---|---:|---:|
| single-a | 1 | Model A's standalone final position |
| single-b | 1 | Model B's standalone final position |
| independent-2 | 2 | One standalone position per model |
| independent-6 | 6 | Three fresh standalone positions per model |
| discussion | 6 | Existing product: independent analysis, critique, final position for each model |

Total: **16 application attempts/task**, 32 development or 64 heldout, 96 if both
are separately authorized. Exactly one repeat in this pilot. Five arm orders rotate
by task index; no adaptive selection, retry, hidden synthesis or model judge. Both
model baselines prevent silently favoring a weaker baseline. Independent-6 controls
application call count, not tokens, hidden SDK retries or inference FLOPs. Standalone
answers use the product's final-position format with empty peer declarations;
discussion uses the unchanged product prompts and validation. This tests the product
workflow bundle (including prompt structure), not a causal peer-discussion-only
ablation. SDK conversation retention inside a discussion follows the product;
standalone samples always start fresh. Reasoning uses each SDK's defaults; no claim
of cross-model/provider equality. Record versions and source hashes.

All arms receive identical task/question context and no external research. Answers
have the same approximate 450-word target; existing prose warnings and blocking
whole-response/schema limits are unchanged. Independent arms run sequentially;
discussion participants run concurrently. Report wall latency and per-call latency
separately; do not claim equal latency scheduling. A six-answer set costs reviewers
more effort than a single answer: grade the usefulness of the entire delivered set,
not an oracle-selected best answer. Retain this limitation in conclusions.

## Human review, fixed before live outcomes

Two independent human reviewers receive only `review/packets.json`, this rubric and
task checks. Keep `private-key.json`, metrics and transcripts from reviewers until
grades are locked. Packet IDs/order are randomized; model/arm metadata and peer
arrays are omitted. Original text remains in private records. Model self-identification
in prose and number of answers can reveal the arm; blinding is partial, not guaranteed.
Missing or invalid answers are visible as unavailable, never dropped from coverage.

Each reviewer supplies one integer 0–4 in each dimension plus rationale:

| Dimension | 0 | 2 | 4 |
|---|---|---|---|
| correctness | Contradicts core supplied constraints or no usable answer | Mixed; at least one material omission | Meets all three task checks without unsupported factual claims |
| alternatives | No meaningful alternative | Names alternatives with limited comparison | Compares plausible alternatives and gives decision conditions |
| actionability | No executable next step | Some steps, incomplete acceptance/rollback | Ordered bounded experiment with acceptance and stop/rollback conditions |
| uncertainty | Fabricated certainty/evidence | Some caveats without consequences | Separates facts/assumptions, preserves dissent and identifies evidence that changes the decision |

Scores 1 and 3 interpolate adjacent anchors. Reviewers judge content, not keyword
presence. Missing answer sets receive zeros with a note; partial sets are graded as
delivered, with omissions penalized. Do not auto-fill missing human grades. No LLM
judge. Record reviewer identity, conflicts, independence and any adjudication separately;
never overwrite original grades. JSON row: `{ "id":"packet-id", "reviewer":"R1",
"correctness":0, "alternatives":0, "actionability":0, "uncertainty":0,
"notes":"Actual independent rationale" }` (example shape, not a grade).

Primary descriptive endpoint: average of four dimensions, averaged over two reviewers,
paired by task. Report discussion minus **stronger of both single-model baselines**,
and discussion versus both independent arms. Publish all four heldout task deltas,
range, mean and reviewer disagreement; count complete paired tasks/4. Do not pool
six answers as six independent task samples. Development results are separate.
Four tasks are too few for a meaningful superiority claim or reliable tail SLO.

Predeclared decision: consider a larger separately authorized experiment only if
all four heldout tasks and all five arms have two grades, discussion beats the stronger
single by ≥0.5/4 on average, no task correctness regresses, and discussion is no worse
than independent-6 on average. Present tokens/calls/latency alongside this quality
screen; user decides whether observed overhead is worthwhile. A negative result or
valid provider failure is useful evidence, not grounds to hide or rerun an arm.
Partial coverage yields an inconclusive pilot, never a fair ranking.

## Preflight and stop gates

Before any authentication/inference: run full offline quality gate, mock pipeline,
missing-dependency isolated test and fixture/rubric anchor checks. Review exact source
revision, clean isolated checkout, package-lock and installed dependency pins, Node
version, dataset and prompt-source hashes, selected model IDs, eligible subscription
accounts, deadlines, settings and call cap. `preflight` never constructs adapters.
Live requires a matching authorization record with protocolHash, maxCalls,
authorized:true, approvedBy, accountEligibilityConfirmed:true and preflightEvidence.
This record documents a human decision; the operator must not fabricate it.

All cells retain original responses, validation and model/usage metadata. Stop the
attempt on provider failure, cancellation, cleanup failure or setup/measurement
exception. A genuine provider failure remains an outcome; a setup defect makes the
comparison invalid. Preserve partial evidence, diagnose without model calls, and
obtain new authorization before a new attempt. Never resume in the same directory.
Invalid structured output is a measured response failure, not a setup defect; retain
it, grade the missing usable answer and do not auto-repair it. Provider failures
stop subsequent rounds and abort active discussion calls under existing policy.

Call caps cover application attempts, not SDK/provider hidden work. 120-second local
call deadline bounds waiting, not remote billing. No hard token/USD ceiling exists.
Claude's per-call $0.50 SDK advisory cap and the product's known-cost session advisory
threshold may stop a run; record this as a failure/partial outcome, not free usage.
Codex USD stays unknown. Provider USD values are not subscription invoices. Explicit
unknown counters are not zero and cache/reasoning breakdowns are not added twice.

## Proposed operational targets

Completion ≥95%; usable final responses ≥95%; declared peer coverage 100% for
completed discussions; discussion wall p95 ≤360 seconds. These are proposed targets,
not user-approved SLOs or demonstrated guarantees. Report denominators and raw values.
The standalone self-contained HTML dashboard requires no network dependencies.
An interrupted attempt may have fewer completed cells than planned; report both.
