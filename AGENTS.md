# Koinous agent guidance

## Progress reporting

For every multi-step request, open each reply with THREE separate 20-cell progress
bars, each with its percentage and rows for all phases/steps (including done ones):

1. **Overall:** use the active P0–P6 table at the top of
   `docs/IMPLEMENTATION_PLAN.md`. The user resumed P6 on 2026-11-02.
   W1–W6 remains completed history within its narrower scope.
2. **Track:** use the active P6 E1–E5 acceptance table. P6 empirical completion
   requires authorized live evidence and independent human grades.
3. **Task:** review, implement, verify, document (equal weights).

Read the relevant plan tables and effort splits before EACH reply; do not reconstruct
them from memory. Use ✅ passed, ▶ in progress (n of m steps), and ⬜ to do, with
weights. Count a phase only when its gate passes; partial credit requires explicitly
listed completed steps. State what moved each bar or why it did not move. Explain
any denominator change before showing the revised percentage. A task/track at 100%
is not the entire roadmap at 100%. Unsized future extensions must be identified as
unestimated, never silently counted as complete or included with invented weights.

Progress measures completed gates, not confidence, elapsed time or production
readiness. End final replies with **Next steps**, distinguishing Codex actions from
user inputs; say "No further steps" when the requested work is complete. Deferred
roadmap items do not authorize new work or model spending.

## Provider validation

Preserve the current request's limits on model spending. Authentication-only
preflight must never create an inference session or send a model prompt. Do not
disable sandbox protections, enable API-key fallback, or silently run paid tests
to work around a failed preflight. Keep credentials and tool binaries out of Git.

Run `npm run check` after source/test changes. Use the PKG first for navigation
and measure blast radius and regression gaps before changing existing symbols.
Preserve the design record in `docs/IMPLEMENTATION_PLAN.md` and existing work.

Application providers must use subscription login, not API-key fallback. Keep
`KOINOUS_PROVIDERS` configurable with one or more supported providers. Discussions
require two or three distinct participants; OpenAI/Claude may each supply two
participants using explicit different model IDs. Preserve legacy selection wire
names and historical IDs. Provider disabling applies to every participant slot.
Preserve explicit unknown costs; never substitute API list prices for subscription
charges. Historical API smoke scripts are not the subscription validation path.

## Current product roadmap

P6 evaluation/operations is active; W1–W6 is complete within its scoped gates.
Enterprise hardening and PKG remain deferred.
Idea-only input is the default. PKG
grounding remains optional and deferred until the rest of the roadmap is complete
and the user authorizes its resumption. Do not resume publication/gateway work as a prerequisite for idea
discussions. Keep disagreement and missing final positions explicit; matching
recommendations are not proof of correctness. Do not add hidden synthesis calls.
Live acceptance requires separate user authorization. Keep the application's
`KOINOUS_ENABLE_INFERENCE` and Grok inference opt-in disabled during offline work.
