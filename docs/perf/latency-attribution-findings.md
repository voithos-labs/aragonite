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

All captures: dev server, DEV asserts active, `--workers=1`, 20 keystrokes each unless noted. Raw: `perf-results/attr-*.json`.

| Axis                     | Fixture                                  | Result                                                                                                                                                                 | Verdict                                                                                                                                                                          |
| ------------------------ | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1 — fan-out**          | uniform flat blocks 100 / 1k / 5k        | `blockRenderCount` = **2 at every count**; render-ms ≈ 0                                                                                                               | **Flat fan-out REFUTED.** Mounted-block-count does not drive prose re-render; the top-level keyed `{#each}` is stable. (This fixture has no nested containers — see Axis N.)     |
| **3 — script vs layout** | uniform 2k blocks                        | script 56ms / layout 39ms / recalc 1.4ms per 20 keys (~5ms/key)                                                                                                        | Flat editing is cheap; script-leaning.                                                                                                                                           |
| **4 — harness overhead** | uniform 1k blocks                        | harness p50 **6.7ms** vs in-page p50 **0.6ms**                                                                                                                         | Harness adds ~6ms fixed/keystroke (poll + IPC + typeSlowly). Negligible at the headline scale; must be subtracted from small numbers. Flat editing is genuinely sub-millisecond. |
| **5 — intra-block**      | single-giant-paragraph 50 / 200 / 800 KB | p50 **13 / 36 / 133ms**; render-ms 56 / 190 / **709ms** /20                                                                                                            | **CONFIRMED.** Single-paragraph cost scales with length, render-dominated (span rebuild). Secondary — only bites pathological long paragraphs.                                   |
| **N — headline direct**  | **nested-containers 1MB**                | harness **913ms** · in-page **283ms** · `blockRenderCount` **22018/20 ≈ 1100/keystroke** · render-ms only **3ms/key** · **script 635ms/key** · layout 17ms · recalc ~0 | **The headline cause.**                                                                                                                                                          |

## Synthesis

**Typing one character into a 1MB nested-containers doc re-renders ~1100 prose blocks** (22018 over 20 keystrokes), and the cost is **scripting — ~635ms/keystroke (dev)** — not layout (17ms) and **not** the span-rebuild itself (3ms/keystroke). CDP attributes **~652ms/keystroke of CPU (script + layout)** — ≈71% of the 913ms harness, comparing mean CPU (CDP total ÷ 20) against the p50 harness latency, so read it as order-of-magnitude attribution, not an exact fraction; the remainder is harness/settle/typeSlowly overhead (Axis 4, amplified by the slow editor) plus the commit's post-tick. The majority of the headline is attributed.

The edit changed exactly one top-level paragraph, so those ~1100 nested blocks' content did not change — their re-render is **redundant**. The flat-block fixtures (Axes 1/3/4) stayed at `blockRenderCount=2` precisely because they have no nested `BlockList`. The most likely mechanism is the top-level publish (`doc.children = [...]`) cascading through nested container subtrees — but **this mechanism is inferred from the count + script-dominance, not directly measured**: `recordBlockRender` counts renders, not their block identity, so cross-block cascade vs same-block thrash vs a false document-level dependency are not yet distinguished (see Measurement caveats). The span-rebuild is cheap; the ~632ms is Svelte reactivity machinery (effect re-runs, `$derived` recompute, SelectionOverlay, `publishRefSlot`, plus DEV asserts) across those re-renders. Prod halves the CPU (913→375ms; DEV asserts + Svelte dev-mode shed); the prod render _count_ was not measured (instruments don't arm in prod), but the surviving 375ms CPU shows the cost is not a DEV artifact.

The cost **class** — scripting that recomputes output for ~1100 blocks whose `raw` did not change — routes to a **finer-grained reactivity fix under every interpretation the data permits**, because the script-vs-layout split (635ms vs 17ms) excludes the layout-bound per-visible-block work that would route to virtual rendering (Axis 1b) or render-path surgery (Axis 3). The spine is settled by the _measured_ split even though the precise mechanism is not. Incremental parsing and lazy `inlineContent` are excluded a priori — neither touches a re-render.

### Adversarial refute

- _Is the 1100 count an instrument artifact?_ `blockRenderCount` increments once per `textRender.render()` call in `TextEditableBlock`'s render `$effect` — these are genuine prose-component render-effect runs, and the independent CDP `ScriptDuration` (635ms/key) corroborates real CPU. Not an artifact.
- _Is it Axis 2 (DEV asserts) in disguise?_ Step zero already proved prod is 375ms, not frame-budget — the cost survives the prod build with asserts tree-shaken. The 1100 re-renders are reactivity, not assertions.
- _Is the re-render legitimate?_ The edit touched one top-level block; the other ~1100 blocks' `raw` is unchanged, so the re-render is by definition redundant. (The precise cascade mechanism — why ~1100 and which blocks — is the first investigation of the fix batch; the cost _class_ is pinned.)

### Ratified next-batch decision

**Spine: a finer-grained reactivity fix that stops the top-level publish from re-rendering untouched nested-container subtrees** (target: cut ~1100 redundant re-renders/keystroke toward ~1). This is the dominant keystroke cost and the highest-leverage, lowest-architecture lever.

**Gating first task of the fix batch (before any patch):** extend the render instrument to record _which_ blocks re-render (path/identity, not just a count) and re-run the nested capture, to confirm the mechanism — cross-block cascade vs same-block thrash vs a false document-level dependency. The patch's shape depends on which; today's data establishes the cost class and the spine, not the mechanism.

Ordered supporting work:

1. **Virtual rendering (0.8.6) stays unconditional but second** — even with the cascade fixed, all blocks remain mounted, so the 10MB mount/render wall persists; VR is still required for the scale gate. The attribution demotes it from "0.8 main act" to "after the reactivity fix" for the _keystroke_ axis, while it remains the owner of the _mount/scale_ axis.
2. **Intra-block sub-block levers (Axis 5)** — sub-block dirty-window re-parse / DOM-diff vs `replaceChildren`; only for pathological single-long-paragraph docs.
3. **Deprioritized:** incremental parsing (0.8.1) and lazy `inlineContent` (0.8.5) — neither addresses a re-render cascade. They remain valid for their own axes (full-parse frequency, undo-reparse) but are not the headline lever.

**Lazy-raw ladder (0.7.4): retire from this batch's concern.** The headline cost is reactivity re-render, not container-raw rebuild (measured ~2ms). The giant-single-container raw-churn question stays render-wall-gated and is not implicated here.

**CI thresholds (companion `perf-gate-ci-spec.md`):** set against **prod** numbers (375ms floor today), with the post-fix target driven by the re-render reduction.

### Measurement caveats

- **Mechanism inferred, not measured.** `recordBlockRender` counts renders, not block identity; confirming the cascade mechanism is the fix batch's gating first task.
- **Prod render count not measured.** Instruments don't arm in prod, so prod confirms the surviving _CPU_ (375ms), not the prod re-render _count_.
- **Single captures.** Each axis is one run; the spec's reproducible-within-rme criterion is a controller re-run before the fix batch sets a CI target.
- **71% mixes mean CPU over p50 latency** — order-of-magnitude attribution, not an exact fraction.
