# 0.8 Latency Attribution — Findings

Machine: dev workstation (see `src/lib/editor/test/perf/baseline.json` machine stamp). Raw artifacts: `perf-results/` (gitignored). Each axis carries its confirm/falsify result. Spec: `docs/perf/latency-attribution-spec.md`; plan: `docs/perf/latency-attribution-plan.md`.

## Step zero — prod vs dev (nested-containers 1MB)

| Build | keystroke p50 | keystroke p95 | flat-prose 1MB p50 (control) |
| ----- | ------------- | ------------- | ---------------------------- |
| dev   | 898.6 ms      | 1087 ms       | 24.3 ms                      |
| prod  | 375.1 ms      | 443.6 ms      | 26.5 ms                      |

Prod build = `vite build` + `vite preview` (SPA, port 1421); dev = `npm run dev` (port 1420). Both type 30 keystrokes into an appended prose paragraph with a doc-length settle.

**Prod/dev delta (nested 1MB): −523.5 ms (−58%).** Dev-only costs removed in prod: `assertInvariant` tree-shake, Svelte dev-mode component/reactivity checks, minification. The flat-prose control is essentially flat (24.3 → 26.5 ms), so the dev overhead is **concentrated in the container-dense shape** — consistent with cost scaling with mounted blocks / per-commit invariant work, not with edit size.

> Artifact note: the prod rows are written by the same `writeResult` as dev, so their `note` field still reads "dev server" — ignore it; these numbers are from the production build on port 1421. (Labeling the note by project is a minor harness cleanup, logged, not blocking.)

**Decision gate:** prod p50 = **375 ms**, ~23× the 16 ms frame budget and far above the ~100 ms proceed threshold → **PROCEED to axis attribution (Task 6).** The editor cost is real. Two carries into Task 6 / synthesis:

1. ~58% of the headline dev number is artifact — Task 6's instrument-based axis captures run under DEV (instruments don't arm in prod), so they attribute the **dev composition**; read the **prod 375 ms as the real floor** any optimization must beat.
2. CI thresholds (companion `perf-gate-ci-spec.md`) should be set against prod-equivalent numbers, not the inflated dev number.

## Axis attribution

_(Task 6 — pending.)_

## Synthesis

_(Task 7 — pending.)_
