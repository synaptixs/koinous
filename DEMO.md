# Koinous team demo

## Fastest setup: no credentials and no model calls

Use Node.js 22.16 or newer (Node 22.10 is the package minimum). Extract the source
archive or clone the repository, then open a terminal in the Koinous project root.
The mock runtime uses Node built-ins and does not require npm install.

macOS/Linux:

```sh
MODE=mock KOINOUS_PROVIDERS=codex,claude KOINOUS_DISABLED_PROVIDERS=grok KOINOUS_ENABLE_INFERENCE=0 GROK_BUILD_ENABLE_INFERENCE=0 node --experimental-strip-types src/server.ts
```

Windows PowerShell:

```powershell
$env:MODE='mock'
$env:KOINOUS_PROVIDERS='codex,claude'
$env:KOINOUS_DISABLED_PROVIDERS='grok'
$env:KOINOUS_ENABLE_INFERENCE='0'
$env:GROK_BUILD_ENABLE_INFERENCE='0'
node --experimental-strip-types src/server.ts
```

Open http://127.0.0.1:3030. These commands do not load a local .env file.
If that port is occupied, set PORT=3031 (PowerShell: $env:PORT='3031') and use that URL.
Stop with Ctrl+C. The server binds to localhost: use screen sharing for the demo.

## Five-minute walkthrough

1. Explain: “Independent analysis → peer critique → revised positions → one attributed recommendation, with disagreements preserved.”
2. Enter: “How should developers search source code and documentation: lexical, semantic, or hybrid retrieval?”
3. Keep Codex and Claude selected, three rounds, and “Use idea and supplied context”.
4. Start discussion. These are deterministic mock stand-ins, not actual model opinions;
   model IDs do not select real models in mock mode. No external research is requested.
5. Show the six replies, peer responses, final recommendation, numbered next actions,
   dissent, validation diagnostics and usage. Matching directions are not proof of correctness.
6. Download the Markdown report. Show its readable sections and original-response blocks.
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

## Developer setup and checks

```sh
npm ci
npm run check
```

The lockfile pins SDK/tool versions. The complete offline check also needs Python 3;
some OS-confinement fixtures are platform-specific. No model calls are made by the
quality gate. The most recent macOS gate passed TypeScript, 473 Node and 33 Python tests.
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
git commit -m "Initial Koinous POC"
git remote add origin <approved-repository-url>
git push -u origin main
```

The repository owner chooses any license before public distribution. No license or
public publication authorization is assumed. The archive contains implementation
history in docs/IMPLEMENTATION_PLAN.md; review it before publishing publicly.
