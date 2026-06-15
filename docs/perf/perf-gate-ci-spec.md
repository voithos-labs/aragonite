# 0.8 Perf-Gate CI — Spec

**Status: drafted 2026-06-15 — PARKED, gated on pinned-runner provisioning (user-assisted). Companion to the diagnosis (`docs/perf/latency-attribution-findings.md`).**

Split from the diagnosis on purpose: the diagnosis is local and unblocks the next-batch decision now; this is infrastructure with a hardware dependency. CI only bites once you are optimizing (the batch _after_ the diagnosis), so it must not stall the diagnosis. Pick this up once a runner exists.

## Purpose

Promote the perf harness's **report-only time rows** (per-keystroke p50/p95, fixture-load wall-time) to **enforceable gates**. Today the machine-independent counter ceilings already gate inside `npm test`; timing rows are report-only because timing is machine-dependent (`docs/testing.md` threshold policy). The roadmap wants this stood up "before (or as the first act of) 0.8" — it is what makes every later optimization _verifiable_: you optimize until the gate goes green at the milestone target, instead of arguing about whether it got faster.

## Provisioning dependency (needs the user)

Stable timing thresholds need pinned hardware. This is the blocking external dependency:

- a **self-hosted runner** (lowest noise, ops cost), or
- a **fixed hosted runner class** (no self-hosting; relies on the same-runner A/B + statistical robustness below to fight noise).

Resolve this before implementation. The rest of the design is runner-agnostic.

## Design

1. **Pinned runner + its own baseline.** CI gets a committed `baseline.ci.json` stamped with the runner's identity. The local `baseline.json` (dev machine) is a reference, never a threshold source.

2. **Noise robustness via same-runner A/B** — the make-or-break detail. Gate on the **delta between the PR and its merge-base, measured in the same job on the same hardware**, so machine variance cancels instead of producing flaky red. Fail only when the regression clears a budget across a **quorum of repeats** (e.g. 2 of 3); gate on the more-stable **p50**, report p95 alongside.

3. **Two threshold kinds:**
   - _Regression budget_ (everyday PRs): "no worse than merge-base + X%." X derived from the runner's measured noise band during standup.
   - _Absolute milestone targets_ (finish lines for the optimization batches): 0.8.1's interactive target (p95 < 16ms at the gated size — the roadmap's stated first target) and the **1.0 scale gate** (10MB keystroke within a committed threshold).

4. **Render-wall deferral, handled like the a11y axe baseline.** Three 10MB shapes can't materialize DOM until virtual rendering (0.8.6) lands — no keystroke number exists for them yet. Gate the **renderable** rows now (≤1MB for those shapes); list the 10MB rows as "render wall — pending 0.8.6," gateable as VR ratchets in. Same fails-closed, only-shrinks discipline as `axe-baseline.json`.

5. **Wiring.** A new perf workflow runs `perf:e2e` on the pinned runner for PRs to main; the expensive 10MB rows run **nightly**, not per-PR. Counter ceilings stay in `npm test` (machine-independent, unchanged). Baseline regen is a deliberate, changelog-noted act — the existing rule that "ceiling bumps are deliberate decisions with a changelog note."

## Success criteria

- The gate is live on PRs to main and green on a clean main.
- **Proven to fail**: an injected known slowdown turns the gate red. A gate that can't go red is theater.
- `baseline.ci.json` committed and stamped with the runner identity.
- The milestone targets (0.8.1 interactive, 1.0 scale gate) are encoded, so the optimization batches have an objective finish line.

## Relationship to the diagnosis

The diagnosis (`latency-attribution-findings.md`) picks _what_ to optimize; this gate measures _whether_ the optimization worked and _when it is done_. They are independent to build and converge at the first optimization batch.
