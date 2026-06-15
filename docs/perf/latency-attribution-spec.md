# 0.8 Latency Attribution — Spec

**Status: drafted 2026-06-15 — diagnosis batch, 0.8's first measurement item (roadmap § 0.8). Implementation plan to follow.**

The companion perf-gate CI is a separate, runner-gated spec: `docs/perf/perf-gate-ci-spec.md`.

## Problem

The per-keystroke latency at 1MB+ is unattributed (`docs/issues.md`). After 0.7.7 (dirty-set sweep scoping) and 0.7.4 (structural-sharing undo), nested-containers 1MB still settles a keystroke at ~896ms p50 on the **dev server**, and reference-heavy 10MB cannot settle one keystroke in 60s. The measured suspects are ruled out as dominant — whole-doc inline sweep (scoped; never dominant), ancestry rebuild (~2ms @1MB), undo checkpoint clone (0.03ms post-sharing). The dominant cost is unmeasured.

This blocks honest 0.8 prioritization: the diagnosis decides whether virtual rendering (0.8.6) or incremental parsing (0.8.1) leads, and arms-or-retires the 0.7.4 lazy-raw revisit ladder. **Diagnosis precedes any further optimization** (roadmap § 0.8; CLAUDE.md "root-cause first").

## Scope

**In:** attribute the ~896ms across named cost axes with confident, reproducible, falsifiable numbers; ship the instrumentation that makes the split possible; produce a ratified next-batch decision.

**Out (YAGNI — explicitly not this batch):** building virtual rendering, incremental parsing, or lazy `inlineContent`; chasing the 10MB render wall; standing up the perf-gate CI (its own spec). This batch builds the _instruments + decision_ that pick which of those comes next — it does not pour any of that architecture before the evidence.

## Step zero — production-mode measurement (gates everything below)

The 896ms is a **dev-server** number, and the repo is explicit these are upper bounds (`docs/testing.md`: "conservative upper bound on production"; the 0.7.4 memo re-measured clone in production for exactly this reason). The single cheapest, highest-information measurement is keystroke p50/p95 in a **production build** (`--mode production`, `NODE_ENV=production`), which tree-shakes `assertInvariant` to a no-op and drops Svelte's dev-mode component checks and unminified code.

Run this **first**. If nested-1MB drops from ~896ms toward frame budget, the urgency reframes and several axes go moot. **The expensive fan-out investigation is gated on this result** — do not fan out until prod-vs-dev is known.

The prod/dev delta is not a single number. It decomposes into three independently-removable dev costs:

- `assertInvariant` overhead (gone in prod by tree-shake)
- Svelte dev-mode component checks (gone in prod)
- unminified code (gone in prod)

Only the first is an "editor cost" in any sense; the other two inflate the dev number but are _already absent_ in shipped builds — not problems to fix. Attribute the delta across these three, don't lump them.

## Cost-axis model

Open axes to attribute (suspects above are already ruled out — do not re-investigate):

| Axis                             | Hypothesis                                                                                                                             | If dominant, the fix class is…                                       |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| **1. Reactivity/render fan-out** | per-keystroke work scales with **mounted blocks**, not edit size — every commit/typing publish re-nudges the top-level keyed `{#each}` | see the **1a/1b sub-split** below — patch vs milestone               |
| **2. Dev overhead**              | the dev server inflates the number (asserts + Svelte dev checks + unminified)                                                          | mostly _not an editor fix_ — reframe urgency; see Step zero          |
| **3. Renderer/layout**           | `replaceChildren` span rebuild + browser reflow on the affected block(s)                                                               | render-path surgery (DOM-diff), or VR if block-count drives layout   |
| **4. Harness settle-overhead**   | `waitForSource*` polling cost sits _inside_ the measured window                                                                        | fix the harness; subtract from Axes 1/3/5                            |
| **5. Intra-block O(block)**      | a single very long paragraph is one block; per-keystroke cost scales with its length                                                   | sub-block dirty-window re-parse; viewport-clamp `findOffsetNearestX` |

**Axis 1 sub-split (load-bearing for the decision):**

- **1a — redundant re-render**: blocks whose `raw` did _not_ change are re-rendered anyway (keyed-`{#each}` re-nudge). A **cheap** fix — finer-grained reactivity / keying so unchanged blocks skip render. A patch.
- **1b — legitimate per-visible-block work**: cost proportional to mounted/visible blocks even after redundancy is removed. Needs **viewport-bounding (VR)** — the largest 0.8 project.

The diagnosis must distinguish 1a from 1b (does the per-keystroke render set include unchanged blocks?). It is the difference between a patch and a milestone.

## Methodology

### Capture vs analysis (CLAUDE.md dispatch policy + noise discipline)

Timing measurement is contention-sensitive — running multiple measurements concurrently on shared hardware injects the exact CPU/cache noise the perf gate exists to eliminate, and CLAUDE.md is explicit: the dispatching session owns long-running benches; subagent-claimed numbers are never accepted. Therefore:

- **The owning session runs every timing/trace capture serially.** No parallel stopwatches.
- **Subagents fan out only on non-timing work**: writing the instrumentation, building fixture generators, and analyzing _already-captured_ CDP traces. Width on everything except the stopwatch.

### Pre-step — the poll-free measurement seam (built first; everything depends on it)

Extend `src/lib/editor/perf/instruments.ts` with:

- in-page `performance.mark/measure` bracketing input → commit post-tick (ground truth independent of the harness polling loop — itself Axis 4),
- a renders-per-keystroke counter (per `BlockHost` render / keyed-`{#each}` diff) that records **which** blocks rendered (to separate 1a from 1b),
- a render-duration measure wrapping the span `replaceChildren`.

Armed under DEV/Vitest only; production pays one boolean check per record site (the existing instruments pattern). Exposed via the `__test.perf` bridge.

### Per-axis isolation

Each axis has a pre-registered test that can **confirm or falsify** it — one variable at a time, others held constant by fixture construction:

| Axis | Isolation (hold all else constant)                                                                                 | Confirm / Falsify                                                                                                                |
| ---- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| 1    | block-count sweep (100/1k/10k) typing one char into a fixed small block; read which blocks rendered                | scales with block count → confirmed; flat → **refuted** (kills the leading hypothesis). Unchanged-blocks-rendered → 1a; not → 1b |
| 2    | prod build vs dev, identical fixture; decompose the delta across asserts / Svelte-dev / minification               | prod ≈ dev → asserts negligible; large drop → number inflated, not editor-bound                                                  |
| 3    | CDP trace Scripting vs Recalc-Style/Layout vs Paint; render-duration on trivial-text vs heavy-inline at equal size | layout dominates → render-bound; scripting dominates → Axis 1/5                                                                  |
| 4    | in-page perf-mark settle time vs harness-reported latency                                                          | harness ≫ in-page → polling contaminates; subtract before trusting Axes 1/3/5                                                    |
| 5    | long-line fixture, block count = 1, sweep paragraph length                                                         | scales with length at constant block count → intra-block                                                                         |

### Three honesty rules

1. **One variable at a time** — block-count sweep ⟂ content-size sweep ⟂ prod-vs-dev, so contributions don't blur.
2. **Subtract Axis 4 first** — Axes 1/3/5 are read from in-page marks, never the polling loop, so harness overhead can't masquerade as editor cost.
3. **CDP category split arbitrates Axis 1 vs 3** — "Svelte reconcile or browser layout" is settled by the trace's buckets, not by inference.

### Fixtures

Built on the existing seeded, golden-pinned generator (`src/lib/editor/test/perf/fixtures/generate.ts`), extended with a block-count parameter: a block-count sweep (fixed content), a content-size sweep (fixed block count), and a long-line sweep (block count = 1).

## Decision tree (outcome → next batch)

The attribution is a dispatch, not a report. Each dominant axis routes to a different next-batch spine; the rest become supporting items ordered by measured share. The CI milestone target (companion spec) says "enough."

| Dominant cost                                    | Next-batch **spine**                                                                                | Supporting                                                          | Rationale                                                                                              |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Axis 1a** (redundant re-render)                | **finer-grained reactivity / keying** (a patch)                                                     | —                                                                   | unchanged blocks shouldn't re-render; cheap, large win if it holds                                     |
| **Axis 1b** (legitimate per-visible-block)       | **0.8.6 virtual rendering**                                                                         | finer-grained reactivity                                            | "block-incremental parsing cannot fix it; only viewport-bounding can." 0.8.1 **demotes** to supporting |
| **Axis 3** (renderer/layout)                     | **render-path surgery** (DOM-diff vs `replaceChildren`) — full VR only if block-count drives layout | 0.8.6                                                               | CDP split decides surgery vs VR                                                                        |
| **Axis 5** (intra-block)                         | **sub-block levers** (dirty-window re-parse, viewport-clamp `findOffsetNearestX`)                   | —                                                                   | neither 0.8.1 nor 0.8.5 reduces single-long-paragraph cost                                             |
| **Inline parse material**                        | **0.8.5 lazy `inlineContent`** (kills per-keystroke double-parse + undo whole-doc reparse)          | rides alongside the winning spine                                   | likely supporting, not dominant                                                                        |
| **Axis 2 / Axis 4 dominate the measured number** | **fix the harness, not the editor**; reframe urgency                                                | only the unconditional render wall (0.8.6) survives as load-bearing | production is fine; ~896ms was partly artifact — the branch that saves the most effort                 |

**Lazy-raw ladder (0.7.4) — deferred, conditional arm:** the trigger is whether giant single MB-scale containers matter _interactively_ — and that shape can't render today (gated behind the render wall). **Arm rung 1 (lazy raw)** only if, after VR makes the shape renderable, its ~10MB/keystroke raw-rebuild churn shows up; otherwise **retire the ladder** and keep materialized raw. **Rung 2 (fully derived raw) stays retired regardless** — rebuilders normalize (table padding, list markers), so deriving breaks round-trip, the editor's primary invariant. This batch records the trigger condition; it does not resolve it.

## Deliverables

1. **Instrumentation seam** — the poll-free marks + render counters above. Permanent; serves every later optimization batch.
2. **Fixture variants** — block-count / content-size / long-line sweeps on the golden-pinned generator.
3. **Attribution report** — the ~896ms split across the five axes, each number machine-stamped (`baseline.json` convention) and carrying its confirm/falsify result.
4. **Ratified next-batch decision** — one named spine + ordered supporting list, committed to the roadmap so the next brainstorm opens from evidence.

## Success criteria

- The attribution accounts for the **large majority** of the measured ~896ms across named axes — no big unexplained residual (ending the "unattributed" status is the point; a 50%-unexplained split has failed).
- Each axis number is reproducible (re-run within rme) and its confirm/falsify criterion was actually run.
- The dominant axis **survived an adversarial refute pass** (e.g. Axis 1 survived the prod-build control proving it wasn't Axis 2 in disguise).
- The next-batch decision (incl. the 1a-vs-1b call) is committed.

## Verification

A measurement batch is verified by reproducibility and behavior-preservation, not new behavior:

- **Instruments get unit tests** — counters increment correctly, the perf-mark span brackets the right window, prod tree-shakes to no-op. A miscounting instrument silently corrupts every future measurement.
- **Fixtures get golden-pin tests** — same (shape, size, seed, block-count) → identical bytes. A drifting fixture invalidates cross-run comparison.
- **Attribution gets the adversarial-refute pass** — a separate reviewer attacks the dominant-axis claim before it's recorded (the repo's verify-before-recording discipline).
- **Behavior preservation** — this adds measurement, not behavior, so the full e2e + multi-seed simulation must stay **byte-for-byte green**. Plus the standard commit gate: `npm test`, `npm run check` (0 errors / 11 warnings baseline), `npm run lint`, perf counter ceilings.

## Follow-on

The ratified decision selects the next batch (virtual rendering / reactivity patch / sub-block levers / lazy inline). The perf-gate CI (`docs/perf/perf-gate-ci-spec.md`) is provisioned in parallel and becomes the objective finish line for whichever optimization batch follows.
