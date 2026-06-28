---
name: aragonite-dispatch
description: Use when dispatching subagents in this repo (implementers, reviewers, fix agents) — brief templates, gate conventions, model policy, and the process rules that keep dispatched editor work from stalling or shipping unverified
---

# aragonite Subagent Dispatch Protocol

How this repo runs subagent-driven development. Pairs with `superpowers:subagent-driven-development` (the generic loop); this skill holds the repo-specific contract. CLAUDE.md § Subagents is the source of truth; where this skill restates it, CLAUDE.md wins.

## Model policy

Dispatch implementers and reviewers on the model CLAUDE.md mandates — **opus 4.8** (§ Subagents: "Run dispatched subagents on opus 4.8"). Don't restate the value elsewhere — a second copy is what drifts. Weaker models stall mid-stream on multi-step editor work and produce unreliable reactivity/invariant edits; if a weaker model ever produced work, recheck it from scratch (read + re-run every gate) before trusting it.

## Every brief opens with

> Invoke the Skill tool for `forge-style`, `forge-docs`, and `forge-tests` and apply them to every file you touch (including pruning pre-existing verbose comments in your path). Project rules: comments explain _why_ only; Prettier with tabs (`npm run format`, then `npm run lint` clean before committing); commits symbol-prefixed lowercase, no trailing period, no co-authored-by / no "Generated with" line; `npm run check` stays at 0 errors.

Then: scene-setting context (where the task fits, what landed before it), the FULL task text (paste it — never make the agent read the plan file for its core instructions; pointing at the plan or a brief file for reference is fine), verified code facts with the warning that line numbers drift (re-locate by grep), and the gate the task must pass. Hand bulk artifacts (task brief, report) over as files, not pasted text.

## Gates

Gate _definitions_ — what the inner-loop, commit, and ship gates run — live in CLAUDE.md § Quality gate and are the source of truth (`npm test` = full unit + every e2e project incl. simulation; `npm run check` 0 errors; `npm run lint`; ship adds `npm run test:editor:perf`). Don't restate the commands; a second copy drifts. This skill adds only the dispatch contract:

- **Name the gate tier in every brief** so the implementer knows which to run for its own iteration vs. for the commit.
- **A brief that permits a lesser gate than the commit gate must say so and why** (e.g. docs-only, verified by the controller reading the diff). Silence means the full commit gate.
- **The long tiers (full e2e, simulation, perf) are the controller's to run, not the subagent's** — see Process rules.

## Two-stage review

- **Spec reviewer** (first): did they build exactly what was asked — nothing missing, nothing extra. MUST re-run every gate personally; implementer-claimed numbers are never accepted. Pick the riskiest claim in the report and probe it adversarially (read the code path end-to-end; mutation-test an assertion if cheap).
- **Quality reviewer** (after spec passes): is it well-built — API shape, hot-path cost in the disabled/common case, comment signal-to-noise, test regression value, file responsibility.
- **Proportionality:** diffs under ~100 lines with self-evidencing tests may take ONE combined spec+quality review. Docs-only commits may be verified by the controller reading the diff.
- Route every review finding to exactly one of: a fix dispatch now, a named later task's brief, or an issues.md/roadmap entry — record where each went.

## Process rules (each one paid for in a real stall or lost run)

- **The controller owns long-running processes.** Full e2e batteries, the simulation suite, and perf rows run from the main session (foreground with adequate timeouts, or harness-tracked background). Agents parked on — or grinding through — multi-minute runs die on a stream-idle timeout. Keep each dispatch bounded.
- **Wide wiring tasks get an inventory command, not a frozen file list.** The brief carries the grep, a per-site classification protocol, and requires the classification table in the report.
- **Implementer reports** use DONE / DONE_WITH_CONCERNS / BLOCKED / NEEDS_CONTEXT. Deviations from plan/brief code are flagged with rationale, never silent. Measurement claims state exactly what was run.
- **Sharp edges to name in briefs touching the editor:** `$state` proxy canonicality (Design Rule 5; `tree-operations/unshare.ts` header), the bytes-scoped aliasing rule (G1.9), reactive state crossing module boundaries as getters not values, no reactive inline-cache reads in the render path (`computeInlineContent` recomputes from `node.raw`). The unit harness cannot catch proxy-class or windowing-flush bugs — the simulation + VR e2e suites are that oracle.
- **e2e block addressing:** the chained block locator (`getBlocks()`) takes minutes at thousands of hosts — address blocks by CST path/index through the `window.__test` bridge (`src/routes/test/editor/test-probes.ts`) instead.
- **Windowing/overlay tasks:** the flush ordering of a reactive read vs. a DOM commit is not assumable — a discriminating e2e that fails for the right reason is the only proof; arm such briefs with a pre-authorized fallback (drive re-measure from the container's own post-flush effect) so the implementer doesn't thrash.
