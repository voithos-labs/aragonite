# 0.8 Latency Attribution — Findings

Machine: dev workstation (see `src/lib/editor/test/perf/baseline.json` machine stamp). Raw artifacts: `perf-results/` (gitignored). Each axis carries its confirm/falsify result. Method/harness: `src/lib/editor/e2e/tests/perf/attribution.perf.spec.ts` (the reproducible captures); parked CI gate: `docs/perf/perf-gate-ci-spec.md`.

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

All captures: dev server, DEV asserts active, `--workers=1`, 20 keystrokes each unless noted. Raw: `perf-results/attr-*.json`.

| Axis                     | Fixture                                  | Result                                                                                                                                          | Verdict                                                                                                                                                                          |
| ------------------------ | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1 — fan-out**          | uniform flat blocks 100 / 1k / 5k        | `blockRenderCount` = **2 at every count**; render-ms ≈ 0                                                                                        | **Flat fan-out REFUTED.** Mounted-block-count does not drive prose re-render; the top-level keyed `{#each}` is stable. (This fixture has no nested containers — see Axis N.)     |
| **3 — script vs layout** | uniform 2k blocks                        | script 56ms / layout 39ms / recalc 1.4ms per 20 keys (~5ms/key)                                                                                 | Flat editing is cheap; script-leaning.                                                                                                                                           |
| **4 — harness overhead** | uniform 1k blocks                        | harness p50 **6.7ms** vs in-page p50 **0.6ms**                                                                                                  | Harness adds ~6ms fixed/keystroke (poll + IPC + typeSlowly). Negligible at the headline scale; must be subtracted from small numbers. Flat editing is genuinely sub-millisecond. |
| **5 — intra-block**      | single-giant-paragraph 50 / 200 / 800 KB | p50 **13 / 36 / 133ms**; render-ms 56 / 190 / **709ms** /20                                                                                     | **CONFIRMED.** Single-paragraph cost scales with length, render-dominated (span rebuild). Secondary — only bites pathological long paragraphs.                                   |
| **N — headline direct**  | **nested-containers 1MB**                | harness **913ms** · in-page **283ms** · `blockRenderCount` 22018 over 20 keys · render-ms only **3ms/key** · script 635ms/key avg · layout 17ms | **Superseded — the 22018 is dominated by keystroke 1's one-time full re-render; the per-key average misleads. See Correction + Synthesis below.**                                |

## Correction — block-identity follow-up (axisM–S) overturned the first pass

The first-pass synthesis read the headline as "~1100 redundant re-renders/keystroke → reactivity patch." The gating block-identity follow-up **overturned that** — it was an averaging artifact. Follow-up captures (nested-containers 1MB, dev):

| Capture                       | Result                                                                        | Meaning                                                                                                 |
| ----------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| axisM (1 keystroke, identity) | 21,980 renders, distinct=21,979, all 7,327 top-level subtrees, depths spread  | First edit re-renders the **whole document once** (false global dependency) — not a partial cascade     |
| axisP (per-keystroke)         | key 1: 21,980 renders / 1111ms; keys 2–6: **2 renders / ~898ms each**         | The full re-render is **one-time** (first edit). Steady state renders only the edited block, ~898ms     |
| axisQ (steady-state CDP)      | TaskDuration 894ms/key · script 606ms · layout 16ms · recalc 0.08ms           | Steady-state cost is all main-thread, script-dominated — with only 2 renders                            |
| axisR (steady-state seams)    | parse 1 (1 block, 0ms) · inlineRefresh 1 (1 node) · rebuild none · snapshot 1 | **Every instrumented editor seam is ~1 unit/keystroke** — the 606ms is outside all of them              |
| axisS (flat block-count)      | 1k→6ms, 10k→44ms, 30k→152ms                                                   | Steady-state latency scales **linearly with mounted block count** (~5µs/block flat; ~18µs/block nested) |

The Axis-N "~1100/keystroke" was axisN folding keystroke-1's one-time full re-render into a 20-keystroke average (21,980 + 19×2 ≈ 22,018 → 1,100). Not a per-keystroke cascade.

## Synthesis (corrected)

Two distinct costs, not one:

1. **Steady-state per-keystroke (the dominant cost): framework reactive-flush proportional to mounted components.** Each keystroke re-renders only the edited block (axisP/R), runs one parse, one inline refresh, one snapshot, no ancestry rebuild — every instrumented editor seam is ~1 unit — yet costs ~606ms script (894ms total task, layout negligible) at nested 1MB. It scales **linearly with mounted block count** (axisS: ~5µs/block flat; ~18µs/block nested, because container components are heavier). The cost is Svelte's per-update reactive flush / keyed-`{#each}` reconciliation traversing all ~50k mounted components — **there is no editor-logic hotspot to patch.** Prod is 375ms (~40% of the dev number is DEV asserts + Svelte dev-mode).

2. **One-time first-edit full-document re-render (a ~1.1s hitch): a false global dependency.** The first edit after load re-renders every block once (axisM: 21,980 distinct blocks across all 7,327 top-level subtrees); subsequent edits don't (axisP). Something makes the first commit invalidate a document-level reactive dependency every block reads. Independent of cost #1, and a one-time hitch rather than per-keystroke.

### Ratified next-batch decision (corrected)

**Primary spine: virtual rendering (0.8.6).** The steady-state per-keystroke cost scales linearly with mounted components and sits outside every editor seam — only bounding mounted components to the viewport changes the O(mounted) scaling. This **vindicates the roadmap's original hypothesis** ("scales with mounted blocks… only viewport-bounded rendering can [fix it]"); the mid-investigation "reactivity patch primary" was the averaging artifact and is **withdrawn**. VR also bounds cost #2's blast radius to the viewport.

Supporting work, ordered:

1. **Reactivity fix for the one-time first-edit full re-render (cost #2)** — locate and break the false document-level dependency that makes the first commit invalidate all blocks. Independent of VR; fixes the ~1.1s first-keystroke hitch. This is where "finer-grained reactivity" genuinely applies — to the _one-time_ invalidation, not the steady-state cost.
2. **Reduce per-mounted-component flush weight** — nested container components cost ~3.6× a flat paragraph per flush; lighter effects/`$derived` shave the constant. Secondary (doesn't change the scaling).
3. **Intra-block sub-block levers (Axis 5)** — for pathological single-long-paragraph docs only.
4. **Deprioritized:** incremental parsing (0.8.1) and lazy `inlineContent` (0.8.5) — neither reduces mounted components.

**Lazy-raw ladder (0.7.4): retire from this concern** — the cost is framework flush, not container-raw rebuild.

**CI thresholds (companion `perf-gate-ci-spec.md`):** set against **prod** (375ms floor today); the post-VR target is O(viewport) keystroke latency.

### Adversarial refute (corrected)

- _Is the steady-state cost really framework flush, not a missed editor seam?_ axisR shows parse / inline / rebuild / render / snapshot all ~1 unit per keystroke; the 606ms is outside them. axisS shows it scales with mounted count even for **flat blocks with zero containers** — so it is per-mounted-component framework work, not container logic.
- _Could a reactivity patch fix the steady-state cost without VR?_ No — only the edited block re-renders, so there is no redundant dependency to break; the cost is intrinsic per-mounted-component flush. A patch can lighten per-component weight (supporting #2) but cannot turn O(mounted) into O(viewport). Only VR does.
- _Is the one-time first-edit re-render a DEV artifact?_ No — it is structural (all subtrees, distinct blocks), and the steady-state cost survives prod (375ms).

### Measurement caveats

- **Prod is dev-instrument-blind.** Instruments don't arm in prod, so the prod 375ms confirms surviving CPU but the per-keystroke seam/render breakdown is dev-only. The flat-count scaling (axisS) and seam-minimality (axisR) are the load-bearing evidence and are dev — re-confirm on the CI runner once provisioned.
- **Single captures.** Reproducibility-within-rme is a controller re-run before the CI target is set.
- **The false-global-dependency's exact source is not yet located** — that is the first task of the cost-#2 reactivity fix.
