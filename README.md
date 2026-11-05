# synqo · Collaborative research

**Discuss an idea with multiple models, compare their reasoning, and keep the disagreements visible.**

synqo (formerly Koinous) is a local-first application for a bounded discussion between two or three
model participants. Start with an idea, optionally add context, then review an
attributed recommendation, alternatives, risks, and next steps.

[Quick start](#quick-start) · [How it works](#how-it-works) · [Decision brief](#decision-brief) · [Run live](#3-run-live--personal-or-enterprise-accounts) · [Documentation](#documentation)

> **Prototype status:** the mock workflow and offline checks pass. Bounded live
> discussions have been exercised, but they do not establish general reliability,
> better answers, or production readiness. Enterprise hardening and PKG integration
> remain deferred. See [Current status](#current-status).

The repository/package name and `KOINOUS_*` settings retain their existing names
for compatibility. Saved discussions continue to open unchanged.

## Quick start

### 1. Get the project

Use **Node.js 22.16 or newer** with npm. The package minimum is Node 22.10.

```sh
git clone https://github.com/synaptixs/koinous.git
cd koinous
```

Already cloned? Stop the running server with **Ctrl+C**, open a terminal in that
same project folder, and update it with `git pull --ff-only`. Restart using either
mode below, then reload the browser. The server loads its UI when it starts;
updating a different checkout or refreshing an old server will not update the page.

### 2. Run the demo — no credentials needed

```sh
npm run demo
```

Open **http://127.0.0.1:3030** or the sample URL printed in the terminal.

1. Open the bundled synthetic discussion, or enter your own idea.
2. Keep research set to **None — use idea and supplied context** for an offline demo.
3. Choose **Draft + targeted review**, choose the author, and select **Start discussion**.
4. Read the decision briefs and expand the original responses when needed.

The demo uses deterministic mock responses. It needs no dependency installation,
login, API key, or VM, and does not load `.env`. Stop it with **Ctrl+C**.

For troubleshooting and the full walkthrough, see [DEMO.md](DEMO.md).

<a id="3-run-live--use-your-subscriptions"></a>

### 3. Run live — personal or enterprise accounts

Live discussions use your provider accounts and consume their usage allowance. Confirm
the intended account and model availability before starting a discussion.

Choose **one** command from the project folder. Stop an existing demo with
**Ctrl+C** before starting live mode.

**ChatGPT/Codex + Claude accounts — personal or enterprise:**

```sh
npm run demo:live
```

**ChatGPT/Codex account only — two OpenAI models:**

```sh
npm run demo:live -- --openai-only
```

The launcher installs pinned dependencies using `npm ci` (internet required),
checks provider account login, and opens missing provider sign-in flows when needed.

1. Complete any browser sign-in with the intended account.
2. Open the localhost URL printed in the terminal.
3. Select models available to your accounts. In OpenAI-only mode, enter
   **two different model IDs**, one for each participant.
4. Enter your idea and optional context. Keep **Draft + targeted review**; choose
   the author or use the **Sonnet 5.5 + Astra** preset, then select **Start discussion**.
5. Review the findings, recorded changes, token accounting and downloadable reports.

Setup sends no model prompts; **Start discussion** sends prompts and uses your
account allowance. Grok stays off in both launchers. Stop with **Ctrl+C**.

- Sign in with a **personal or enterprise OpenAI/Claude account**, including provider-managed SSO when required; model API-key fallback remains disabled.
- Login status does not establish model entitlement, remaining quota, or corporate workspace selection.
- Different requested model IDs can be aliases; distinct underlying models are not guaranteed.
- Missing cost information stays **unknown**, rather than being treated as zero or an invoice.

Follow [the live setup guide](DEMO.md#personal-or-enterprise-accounts-for-real-discussions)
for account setup and manual controls. Advanced Grok runtime instructions are in the
[engineering reference](REFERENCE.md#grok-build-subscription-adapter-inference-requires-explicit-opt-in).

### Ollama Cloud + Local

Each participant has one row with a **Provider** and **Model ID**. Choose
**Ollama Cloud** or **Ollama Local** in the same provider selector as OpenAI and Claude.
Both Ollama locations use
your local Ollama app/API. Local models run on your machine; Cloud sends prompts to
Ollama Cloud using `ollama signin`, with no API key stored in synqo.
See [Ollama's authentication guide](https://docs.ollama.com/api/authentication).

1. Install/start [Ollama](https://ollama.com/download) and add the models you want
   in Ollama first. For Cloud, sign in with `ollama signin`.
2. For a mock walkthrough, use `npm run demo`; **Refresh models** returns labeled
   demo choices without contacting Ollama.
3. For real Ollama-only discussions, install dependencies once with `npm ci`, then:

   ```sh
   npm run start:real -- --enable-inference --ollama-only
   ```

4. Open **http://127.0.0.1:3030**. Choose Local or Cloud as the provider in each
   participating row, click **Refresh models**, then choose a registered model.
   Local discussions can start only after an installed model is found; an unlisted local ID cannot
   start a discussion.
   Both rows can use Local or both can use Cloud, with different model IDs.
5. Choose the author and start the discussion when ready to use model resources.
   The normal Codex + Claude live launcher also exposes Ollama for mixed pairings.
   OpenAI-only mode keeps other providers disabled.

Refresh lists only models registered with your daemon; it does not download models,
check Cloud quota or send an inference prompt. synqo verifies Local/Cloud metadata
before a chat. Ollama uses **model default effort**, which may differ across models.
Token counts and latency appear in the existing UI and exports; missing usage and
USD remain unknown. No Ollama live acceptance run has been performed.
See [Ollama setup and troubleshooting](DEMO.md#ollama-cloud--local).

### Optional research: Wikipedia, web search, or both

Research is **off by default**. In the Research selector choose **None**,
**Wikipedia**, **Web search**, or **Wikipedia + web search**. Enter a separate
public query; only that query is sent to the selected services, not your private
idea or context. All participants receive the same recorded source snapshot.

Wikipedia retrieves up to five English article introductions. Web search uses
[Brave Search API](https://api-dashboard.search.brave.com/app/documentation/web-search/get-started)
and retrieves up to five result snippets; it does not open the full pages.
Coverage, retained/omitted results and partial excerpts are recorded. Retrieval
is not fact checking. If a selected service fails, the session stops before model
calls rather than silently continuing with fewer sources.

For web search, the server operator supplies `BRAVE_SEARCH_API_KEY` in the server
process environment before starting synqo. With no key configured, web choices
are unavailable; Wikipedia and no-research discussions still work. The key never
appears in the browser or model SDK environment. It authenticates the separate
search service, not a model provider; its usage/charges are separate from the
model token accounting. See [research setup](DEMO.md#optional-research).

## How it works

**Draft + targeted review is the UI default.** Select exactly two OpenAI, Claude or
Ollama participants and choose the author. OpenAI/Claude authors use low effort and
reviewers medium; Ollama uses model default effort. The preset selects Sonnet 5.5
and Astra. Model availability depends on the provider and your account/local setup.
Optional acceptance checks define what a sound answer
must get right.

| Stage | What happens | Application calls |
|---|---|---:|
| Draft | Author writes one concise recommendation | 1 |
| Targeted review | Reviewer identifies up to three concrete defects, or no material issue | 1 |
| Conditional revision | Author responds only when material actionable findings exist | 0 or 1 |

Each stage uses a fresh request with bounded task/draft/finding data. Targeted
OpenAI/Claude requests use an empty working directory; Ollama uses fresh text-only
chats without tools or imported SDK history. Custom Ollama model templates and
system defaults still apply. No full
conversation history, extra judge, synthesis or automatic repair/retry call is
added. Malformed responses stop the workflow and preserve originals. Cosmetic-only
feedback keeps the original draft. Authors can address, reject or leave findings
unresolved; **addressed is a declaration, not a verified fix**.

The UI and Markdown/JSON exports show the original draft, reviewer findings,
author responses, changed fields and per-call input/output, primary, helper and
unclassified tokens. Missing usage stays unknown; cached/reasoning counters are
subsets. These are provider accounting values, not subscription invoices. Token
savings and quality gains from this workflow have **not been measured live**.

Choose **Full discussion** to retain the earlier symmetric workflow:

| Round | What participants do | What you receive |
|---|---|---|
| **1 · Independent analysis** | Evaluate the idea before seeing peers' answers | Initial reasoning, alternatives, assumptions, and risks |
| **2 · Peer review** | Examine each available peer's arguments | Adopted, rejected, or unresolved points with reasons |
| **3 · Revised position** | Respond to critiques and state a final position | An attributed recommendation and decision brief |

A full discussion uses **six application calls for two participants**, or **nine
for three**. Shorter runs are exploratory. These bounds count application calls,
not hidden provider or SDK work. There is no extra model call to synthesize the result.

An idea alone is enough. Optional Wikipedia retrieval provides up to five background
introductions from explicitly entered public keywords. It is not comprehensive
research or primary-source verification. Only those keywords are sent for retrieval;
the private idea and context are not used as the search query.

## Decision brief

Each validated participant's brief makes the choice easier to inspect:

| Field | What it tells you |
|---|---|
| **Recommended action** | The participant's proposed course of action |
| **Alternative** | The strongest credible alternative, or an explicit declaration that none is feasible |
| **Tradeoff** | Why that choice is preferable under the stated assumptions |
| **Switch condition** | The evidence or condition that would change the decision |
| **Response to peer review** | What the participant says it adopted, rejected, or left unresolved |
| **Risks and next actions** | What remains uncertain and how to test the proposal |

These are **participant declarations, not independently verified improvements**.
Matching answers are not proof of correctness. Coverage gaps, unsupported claims,
and dissent remain visible; similar answers are not silently merged.

Older sessions show **Not recorded** for fields they never contained. Reopening a
session or downloading its Markdown report makes no model calls and preserves the
original saved assessment and responses. Use `?format=original` on a report URL to
retrieve the exact stored report. The JSON download includes canonical token
accounting and recorded targeted-review data when available.

The [decision-brief contract](REFERENCE.md#decision-brief) documents validation,
field limits, and saved-session compatibility.

## Current status

| Area | Status and limits |
|---|---|
| **Idea discussion and history** | Scoped workflow acceptance completed; saved discussions, reports, and original responses are available |
| **Decision briefs** | Implemented in PR #11; parser, UI, exports, compatibility, and mock browser checks passed |
| **Evaluation and operations** | Harness and offline gates passed; development evidence is incomplete and Grok review is provisional product feedback |
| **Empirical acceptance** | Heldout and independent human-review gates remain incomplete; no superiority claim |
| **Personal/enterprise provider accounts** | Browser account login and provider-managed SSO wording supported; selected corporate workspace, organization entitlement and quota are not verified by login status |
| **Optional research** | None by default; Wikipedia, Brave web-search snippets, or both; shared recorded evidence and no implicit fallback |
| **PKG and enterprise work** | Deferred; neither is required for the ordinary idea-discussion workflow |

The latest offline gate passed **TypeScript, 610 Node tests, and 33 Python
tests**. These checks validate software behavior; they do not establish answer quality.
The original roadmap remains **48.33%**, with **P6 at 80%**. Those figures describe
its broader acceptance gates, not the usability of every shipped feature.

## Development

Install the pinned dependency graph and run the offline quality gate:

```sh
npm ci
npm run check
```

`npm run check` typechecks source and tests, then runs Node and Python regressions.
It makes no model calls. The full macOS confinement gate also requires Command Line
Tools (`/usr/bin/clang`); other operating systems are not certified by that evidence.
See [OPERATIONS.md](OPERATIONS.md) for environment requirements and stop/recovery rules.

## Documentation

| If you want to… | Read |
|---|---|
| Run the mock demo or connect personal/enterprise accounts | [Demo and setup guide](DEMO.md) |
| Operate, verify, or recover a run | [Operations](OPERATIONS.md) |
| Understand the benchmark and its acceptance limits | [Evaluation protocol](evaluation/PROTOCOL.md) |
| Follow the full roadmap and design history | [Implementation plan](docs/IMPLEMENTATION_PLAN.md) |
| Inspect provider settings, API details, isolation, or historical evidence | [Engineering reference](REFERENCE.md) |
| Contribute changes using repository conventions | [Agent and contributor guidance](AGENTS.md) |

The engineering reference preserves the previous README in full. Its dated records
remain available without obscuring the everyday setup and workflow above.
