# Feature: E2E Perf — The Keystroke Regression Gate

The commit-blocking half of the perf harness. Where `typing-latency.md` _measures_
every shape × size and reports, this gate _fails_ when a curated subset regresses
past its recorded baseline. Armed only by `PERF_GATE` (`npm run perf:check`);
without it every row skips, loudly rather than silently — a skipped gate that
reads green would be theater.

Deliberately outside `npm test`: the timing rows are slow, and a single-machine
timing gate belongs at a merge/ship boundary, not on every commit.

## What it gates

Per-keystroke **p50** for each gated row, against `src/lib/test/perf/baseline.json`.

- p50, not p95 — the median is the stable statistic; p95 catches a single GC pause
  and is reported, never gated.
- Gated rows are the ones whose cost should be **O(viewport)**: every ≤1MB shape,
  plus each renderable shape's 10MB keystroke. Gating at 10MB is the point — it
  guards the O(viewport) claim against an O(document) regression that would hide
  entirely at 1MB.
- `single-giant-paragraph` is recorded, not gated: its span rebuild is
  O(paragraph length), a genuinely different axis that windowing cannot bound.

## The budget

`ceiling = (baseline_p50 × 1.1 + 5ms) × PERF_RUNNER_SCALE`

- The 10% factor clears measured same-machine run-to-run spread (~3–4%) while
  still catching a real slowdown.
- The 5ms floor keeps cheap rows from tripping on a few milliseconds of jitter.
- `PERF_RUNNER_SCALE` defaults to 1 (the calibration machine — the tight gate).
  Slower environments scale the whole ceiling instead of re-blessing baselines
  per host; CI sets it in the workflow env, which makes the CI gate a
  gross-regression net rather than a re-tuned one.

## Baseline policy

The baseline is re-blessed **deliberately**, with a changelog note, when a
Chromium / OS / toolchain bump genuinely moves the floor. Never to silence a
regression. A row that regressed is a bug until proven to be a moved floor.

## What this gate cannot see

Steady-state p50 only. A one-slow-keystroke regression — a first-edit full
re-render, say — barely moves a 30-sample median. That class is guarded
separately, by the block-render-scoping count assertion inside the fast
`npm test` gate.

Rows also run under the dev server with DEV invariant assertions active, so every
number is a conservative upper bound on production, not a production latency.

## Error cases

- a keystroke whose CST commit never lands fails the row via settle timeout
  rather than recording a bogus latency
- a baseline row missing for a gated shape × size fails the row rather than
  passing vacuously
