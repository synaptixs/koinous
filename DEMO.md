# synqo team demo

## OpenAI-only corporate demo

If your team uses only corporate ChatGPT/Codex access, run:

```sh
npm run demo:live -- --openai-only
```

This installs pinned dependencies and reuses your local ChatGPT login or opens
Codex's browser login flow when needed. Sign in with your approved corporate
account. It checks only Codex; Claude and Grok are disabled, with no API-key
fallback. An existing login is reused, so confirm it is the intended corporate
account before starting. synqo does not select an enterprise workspace for you.

In the UI, enter **two different model IDs** available through that account,
one for each OpenAI participant. The default targeted workflow uses a low-effort
author, a medium-effort reviewer and a conditional low-effort revision (two or three
calls). Choose the author in the UI. Full discussion remains available for the
earlier three-round, six-response exchange. Each participant retains its selected
model and accounting. Both use the same
local subscription login. Start discussion sends prompts; setup sends none.
Stop with Ctrl+C when finished.

Your organization must allow Codex and both requested models. Login status is
not an entitlement or quota check. No model list is invented or automatically
probed, and a rejected model stops the discussion without fallback or retries.
Different requested IDs can be aliases; synqo cannot prove distinct underlying
models when the provider does not report their resolved identities. Two models
from one provider are not independent evidence of correctness. Subscription USD
costs remain unknown when the SDK supplies no cost.

This path is verified offline and in the mock UI. Corporate authentication and
live two-OpenAI-model inference have not been tested. The earlier live acceptance
covers Codex plus Claude, not this new combination.

## One-command live demo

Install Node.js 22.16 or newer with npm, extract the bundle, then run in its folder:

```sh
npm run demo:live
```

This command installs pinned dependencies using `npm ci` (internet required;
replaces node_modules on each launch), reuses existing provider account logins, opens
any missing personal/enterprise ChatGPT/Claude account login flow, and verifies the login method
before starting the existing live UI. Complete the provider browser sign-ins yourself.
No API-key fallback, credentials copied into the project, or model prompts during
setup. Login status confirms the method, not quota or model access. Grok stays off.

Open the localhost URL printed in the terminal. Select models available to your
personal or enterprise accounts, enter an idea, keep Draft + targeted review, choose the author,
and click Start discussion. Only
that click sends model prompts and uses provider account quota. Stop with Ctrl+C to
end the server's inference opt-in. Startup errors stop without automatic retries.
Existing manual setup commands below remain available for troubleshooting.
`npm run demo:live -- --help` prints offline instructions without installation/login.

The one-command setup is offline-tested with fake installation/authentication/server
steps; no new live login or model run was made while implementing it. The underlying
Codex/Claude discussion path has passed a bounded live UI run with six responses,
complete peer coverage, a nonblocking length warning and an attributed recommendation.
Other operating systems and new-account browser login flows remain unverified.

## Ollama Cloud + Local

Use a current [Ollama](https://ollama.com/download) release with `/api/tags` and
`/api/show` location metadata and text-completion capabilities. Start the app/daemon.
Local models must already be downloaded; Cloud model entries must be registered
with that daemon. Choose models in Ollama first. synqo never pulls models or
starts sign-in. Cloud additionally requires `ollama signin` with your intended
Ollama account; it uses Ollama's [local authenticated API path](https://docs.ollama.com/api/authentication),
not the direct cloud API-key path.

```sh
npm ci
npm run start:real -- --enable-inference --ollama-only
```

This launcher does not require OpenAI or Claude login. It starts a server, with no
model prompts until **Start discussion**. Open http://127.0.0.1:3030 and find **Ollama Cloud + Local**. Click
**Refresh models** to check availability without inference. Local selection is
disabled until installed models are found; only listed local models can be used.
If none are installed or Ollama is unavailable, choose Cloud or another provider.
Select two participants and choose models. Each has a
second slot for another model from that location. Same-provider slots require
different explicit IDs. The ordinary Codex + Claude launcher also exposes Ollama
for mixed selections; `--openai-only` disables it.

**Refresh models** reads only the local registry. Cloud names are daemon model
names, which can differ from direct cloud API names. If the list is empty, add the
model through Ollama outside synqo and refresh. Refreshing one local slot updates
both local slots; removing the last local model clears local selection. If the list is unavailable, check
that Ollama is running. If metadata is unsupported or Local/Cloud doesn't match,
update Ollama or choose the correct location. An authorization error for Cloud
requires signing in outside synqo; a listed model does not prove entitlement or quota.

Default endpoint: `http://127.0.0.1:11434`. Set `KOINOUS_OLLAMA_URL` before startup
for another loopback HTTP origin/port. Remote URLs, credentials, paths and redirects
are rejected. `OLLAMA_LOCAL_MODEL` / `OLLAMA_CLOUD_MODEL` can supply defaults with
the general `npm start` entry point; all selections remain editable in the UI.
`OLLAMA_LOCAL_TIMEOUT_MS` / `OLLAMA_CLOUD_TIMEOUT_MS` override the default per-call
deadline (`MODEL_TIMEOUT_MS`, normally 120 seconds). Local loading can consume
much of that deadline. An abort stops waiting; it cannot guarantee remote work stopped.

The application uses model default effort for Ollama and sends no tools. Token
usage is reported input + output; cached prompt tokens are a subset. Unreported
helper usage and cost remain unknown. Saved selections, token accounting and
Markdown/JSON downloads use the same workflow as other providers. Protected
multi-tenant mode does not expose the personal daemon. Offline mock UI/tests
verify integration; live compatibility, recommendation quality and savings remain
unverified. No new inference run is authorized by this documentation.

## Optional research

The Research selector defaults to **None — use idea and supplied context**.
Select Wikipedia, Web search, or both only when you want external research. Both
services receive the same explicit public query. The idea/context are not used as
implicit search queries. Avoid entering private information in the query field.

Wikipedia needs no key. To enable web search, obtain a Brave Search API key from
[Brave's dashboard](https://api-dashboard.search.brave.com/) and set
`BRAVE_SEARCH_API_KEY` in the server environment before startup. For example, in
Bash/Zsh use `export BRAVE_SEARCH_API_KEY='<your-key>'`; in PowerShell use
`$env:BRAVE_SEARCH_API_KEY='<your-key>'`. Then use the existing `start:real` or
`demo:live` launcher. Do not paste this key into the model selector, research
query or discussion. The live launcher forwards it only to the app server, never
to installation/authentication steps or model SDKs. No Brave key is required for
Wikipedia-only or no-research use.

Research retrieves at most five Wikipedia introductions and five Brave snippets,
with one request per selected service, a shared ten-second deadline and a 128 KiB
response cap per service. It never follows result URLs or automatically retries.
If either selected service fails, no model prompt is dispatched. Both-source
retrieval can therefore use up to 256 KiB before the shared prompt-size check.
Results disclose partial excerpts, omitted candidates and unknown total relevant
coverage. Search-service charges are separate and are not reported as model cost.

The exact query, source IDs, excerpts, provider/scope metadata and snapshot hash
remain in saved sessions and Markdown/JSON exports. Reopening does not repeat
research. Legacy Wikipedia-only sessions remain readable without new web calls.
Research does not imply source correctness or independently verified quality.

Personal/enterprise provider account login uses the existing pinned provider
browser flows. OpenAI's [authentication guide](https://learn.chatgpt.com/docs/auth)
and Claude's [authentication guide](https://code.claude.com/docs/en/authentication)
describe managed-account access. Login status confirms the authentication method;
it does not verify your intended enterprise workspace, seat, model entitlement
or quota. synqo's own protected OIDC enterprise sign-in/deployment is a separate
configuration and acceptance gate; this change does not mark P5 complete.

## Fastest setup: no credentials and no model calls

Use Node.js 22.16 or newer (Node 22.10 is the package minimum). Extract the source
archive or clone the repository, then open a terminal in the synqo project root.
The mock runtime uses Node built-ins and does not require npm install.

On macOS, Linux or Windows PowerShell:

```sh
npm run demo
```

Open the sample URL printed in the terminal, or http://127.0.0.1:3030 and select
**[SYNTHETIC DEMO] Improve developer search over source code and documentation**
in Saved discussions. The bundled sample has six synthetic responses, peer reviews,
a final recommendation, next actions and disagreements. It is not a real model run.
Startup copies it into ignored `runs/` once; subsequent starts preserve existing data.

The launcher does not load `.env` and overrides inherited provider/mode/inference
settings: mock Codex and Claude initially selected, mock Ollama choices available,
Grok off, both live-inference switches disabled.
No login, API key, VM, dependency installation or model call is needed. New discussions
are also mock-only. Keep research set to “None — use idea and supplied context” for an offline demo.

If port 3030 is occupied, use `PORT=3031 npm run demo` on macOS/Linux, or set
`$env:PORT='3031'` before `npm run demo` in PowerShell. Stop with Ctrl+C.
The server binds to localhost: use screen sharing for the demo.

## Validation policy and current readiness

Overlength prose fields now display length warnings and remain usable for peer
coverage and final recommendations. The text and diagnostic counts are preserved.
Malformed JSON, invalid or duplicate peer IDs, missing fields, excessive list counts,
identifier/reference limits and whole-response size limits still block parsing.
Warnings never imply factual correctness or consensus; differing recommendations
remain visible. Existing saved assessments are preserved as historical records.

Two previously failing real discussions were replayed offline using their exact
saved responses: both now have complete peer coverage and two usable final positions.
Separate replay reports retain warnings and disagreements; the original files were
unchanged. This verifies the handling of those saved failures, not a new live run.
A later bounded live UI discussion completed all six responses with full peer
coverage and a nonblocking warning. This demonstrates that workflow, not universal
reliability for every idea. The mock walkthrough remains available.

## Five-minute walkthrough

1. Explain: “One draft → focused defect review → revision only for material findings, with unresolved issues preserved.”
2. Enter: “How should developers search source code and documentation: lexical, semantic, or hybrid retrieval?”
3. Keep Codex and Claude selected, Draft + targeted review, Claude as author, and “None — use idea and supplied context”.
4. Start discussion. These are deterministic mock stand-ins, not actual model opinions;
   model IDs do not select real models in mock mode. No external research is requested.
5. Show the two mock replies, skipped revision, retained draft and per-call token accounting. Mock findings and zero tokens illustrate plumbing only. Offline tests exercise the material-finding/third-call branch.
6. Download Markdown and JSON. Show findings, changes, original responses and identical token accounting.
7. Reload and reopen the saved discussion to demonstrate persistence without inference.

## Presenting the existing real PKG-search discussion

On the presenter's existing machine, the saved viewer is available at:
http://127.0.0.1:3053/?page=1&session=f52714bf-4247-4877-8a0c-2eaa41ec9355

That is a local running viewer, not a deployed service. Its inference is disabled.
The source archive intentionally excludes all saved runs and personal credentials.
To show this discussion on another machine, review its content for sharing, then
copy ONLY its session directory containing events.jsonl and report.md into
runs/<session-id>/ in the extracted project. Start the mock app above and reopen it
from Saved discussions. Do not copy a provider home, auth.json, .env, or VM files.

Be candid: the real run returned six replies and two valid final positions, but
both round-two structured reviews exceeded a field limit. Warnings remain visible;
structured peer-review coverage is incomplete. It supports a demonstration of
collaboration and traceability, not a claim that every validation gate passed.
The shared direction is a lexical plus typed-graph baseline, then an evaluated
semantic/hybrid comparison. Exact-hit priority and code/documentation authority
remain disputed. Costs are partially unknown, not zero.

<a id="use-your-own-subscriptions-for-real-discussions"></a>

## Personal or enterprise accounts for real discussions

Each person runs synqo locally and signs in with their own accounts. Browser login
is handled by the pinned provider CLI, not a password or token form in synqo.

```sh
npm ci
npm run setup
npm run setup -- login codex
npm run setup -- login claude
npm run setup -- status
```

The two login commands open the provider browser flows. Choose your ChatGPT account
for Codex and a claude.ai personal or enterprise account for Claude. Complete
your provider-managed SSO flow if your organization requires it, and confirm the
intended workspace and administrator-granted access. They store credentials in the
provider's normal local credential store (including any existing CODEX_HOME or
CLAUDE_CONFIG_DIR override). No credentials are copied into the repository or shared
with teammates. Existing CLI sign-ins may be reused: start with `setup -- status`.
Organization-managed restrictions still apply; mismatched existing authentication
may require signing in again. No API-key or Console billing fallback is offered.

`setup` by itself prints instructions offline. `login` and `status` are explicitly
requested authentication commands; neither sends a model prompt. Status displays
only ready/not-confirmed, not account details, tokens or raw provider output.
It confirms the reported authentication method, not current quota, model access or
successful inference. Unknown/unsupported methods fail closed.

When ready to use your personal or enterprise account quota, deliberately run:

```sh
npm run start:real -- --enable-inference
```

This checks both provider account logins and starts localhost:3030 with Codex and Claude.
Choose models and the author in the UI, enter your idea, and press Start discussion.
Targeted review uses two or three application calls; Full discussion retains up to
six calls for two participants. In either mode, internal SDK behavior
and tokens are not a hard monetary ceiling. Unknown subscription costs stay explicit.
The launcher itself sends no model prompt. It does not load or change .env.
Without the flag it refuses startup, even if live flags were inherited from the shell.
Grok remains disabled. Ctrl+C stops the server; it does not persist inference opt-in.
Use `npm run demo` anytime for synthetic discussions without subscription usage.

Pinned login command contracts were checked with local CLI help and official
[Codex authentication](https://learn.chatgpt.com/docs/auth) and
[Claude CLI reference](https://code.claude.com/docs/en/cli-reference) documentation.
The setup uses ChatGPT-only Codex configuration and Claude's explicit `--claudeai`
flag; inherited API keys and custom endpoint/cloud routing are excluded from the
provider environment. Fresh-clone authentication status confirmed both existing
subscription logins. The latest bounded live UI discussion completed six responses,
complete peer review coverage and two usable final positions, preserving a length
warning and disagreements. The new one-command wrapper is verified offline only;
new-account browser login flows remain unverified.
Platform-specific native CLI packages
must be present after npm ci. macOS was the development test platform.

## Developer setup and checks

```sh
npm ci
npm run check
```

The lockfile pins SDK/tool versions. The complete offline check also needs Python 3;
some OS-confinement fixtures are platform-specific. No model calls are made by the
quality gate. See the implementation plan for the latest verified offline gate.
A live demo is a separate deliberate step requiring the presenter's own subscription
logins and explicit inference enablement. Do not use API-key fallback. Grok stays off.
Enterprise hardening and PKG integration remain deferred.

## GitHub handoff

Create a new private repository under the agreed owner. Publish the extracted clean
source folder, not the containing projects directory. This archive contains no Git
history and must not inherit the presenter's unrelated parent repository.

```sh
git init -b main
git add .
git status --short
# Inspect the staged paths; .env, runs and node_modules must be absent.
git commit -m "Initial synqo POC"
git remote add origin <approved-repository-url>
git push -u origin main
```

The repository owner chooses any license before public distribution. No license or
public publication authorization is assumed. The archive contains implementation
history in docs/IMPLEMENTATION_PLAN.md; review it before publishing publicly.
