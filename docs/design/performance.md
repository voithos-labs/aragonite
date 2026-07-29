# Editor Performance

## The one idea

**The editor only mounts what you can see.** A 10MB document and a 10KB document have the same number of live components on screen, so typing costs the same in both. That is virtual rendering (`docs/design/virtual-rendering.md`), and nearly every performance property below is downstream of it.

The exceptions are the axes windowing can't reach — loading a document, editing inside one enormous block, and any derivation that walks the CST rather than the mounted set — and all are called out here on purpose.

## Scale claims

Qualitative shape; the exact numbers live in `src/lib/test/perf/baseline.json`.

- **Keystroke latency is O(viewport).** Single-digit milliseconds on realistic documents, and it stays bounded into the 10MB range because windowing caps the mounted component set at what's on screen. The three axes below are the exceptions, and they are exceptions because they read something other than the mounted set.
- **Document load is O(document size).** The reactive tree is materialized up front — `$state`-proxying every node, assigning ids, seeding heights — which is script-bound and linear in node count. Sub-second at realistic sizes; multi-second only at the hundreds-of-thousands-of-blocks extreme. Windowing bounds the _mount_ at load, not this materialization. The only lever is lazy or shallow proxying of the node tree, an architectural change deferred until a workload needs it.

Three keystroke axes are **not** viewport-bounded. The first is recorded as a reference rather than gated; the second is gated at its own baseline; the third is neither yet, and rides the rung-fixture work ledgered in `docs/issues.md`:

- **Intra-block long-paragraph editing.** A single block's span rebuild scales with paragraph length — windowing windows blocks, not the interior of one block. It is transient: any Enter splits the paragraph into viewport-bounded blocks, so it only surfaces from pasting a multi-MB blob into one block. The lever, if a real workload ever needs it, is intra-block DOM reconciliation of the rebuilt span run. One shape inside this axis is superlinear, measured and ledgered rather than fixed: an emphasis-dense single block scans quadratically (`docs/issues.md`, emphasis-flood watch entry).

- **Typing into a giant container's head child.** A container's `raw` holds its full outer source, so `rebuildRaw` re-concatenates the whole container on every keystroke inside it — and when the caret sits in the container's FIRST child, the rewritten line is the container's own opener line. Measured at 1MB: **~52 ms** per keystroke for a single giant list, **~29 ms** for a giant blockquote, against ~2.6 ms for the same fixtures typed into a paragraph ahead of the container. This is a property of the container `raw` contract (§ 9 of `editor.md`), not of any one feature: it measures the same with the container kind re-derivation disabled. It went unrecorded until 2026-07-28 because every latency row prepended a paragraph so the caret had a top-level home; the `giant-single-{list,blockquote} head 1MB` rows now type inside the container and are gated at that baseline, so the axis cannot get worse unnoticed. The lever, if a workload needs it, is an incremental container-raw rebuild that splices the changed child's bytes instead of re-concatenating every child.

- **A live whole-document derivation.** Anything that reads the editor's **content version** walks the CST, not the mounted set, so windowing cannot bound it: while one such reader is mounted, every keystroke anywhere costs one touch walk over every node plus that reader's own walk. The bundled footnote reference is the only reader today, and it is the reader that pays: with no `[^label]` widget mounted, the version is a lazy derived that never computes and the cost is zero. Node-measured at ~0.23 ms per keystroke over 60 blocks; extrapolate the shape, not the constant. This is far cheaper than what it replaced (each mounted widget used to inline-parse the whole document itself, 10–140× worse), but it is O(document nodes) rather than O(viewport), and the read set is deliberately wider than any one reader needs — a metadata, trivia, or inner-affix write invalidates every reader, where before it invalidated none. The lever, if a workload needs one, is an incremental version rather than a whole-tree touch. **Not gated:** the standing fixtures mount no reference widget. Measuring it rides the rung-fixture pass in `docs/issues.md` § "Installed inline-rung consultation is unmeasured by the standing perf gate", whose bracket-dense footnote fixture must be typed into with a reference widget **in the viewport** — the mounted derivation and the scanner consultation are two mechanisms sharing one fixture.

One further cost rides the container axis without being per-keystroke: the container **kind re-derivation** parses the container's whole raw when its opener line's verdict moves (a typed `> [!TIP]` turning a blockquote into a GitHub alert). That is one parse per kind transition — ~53 ms on a 1MB blockquote, against ~5 ms for the neighbouring keystrokes — and it is the feature doing its work, not an axis: ordinary typing on an opener line never reaches it, because the gate compares what the line opens as, not whether it changed.

A flat high-block-count keystroke cost was once recorded here as an O(top-level-count) axis. Measurement showed it was a **harness artifact** — the latency harness summed the whole `$state`-proxy children array on every settle poll — not editor work. Flat-document keystrokes are O(viewport) like every other shape, unless a whole-document derivation is live (third axis above).

## Where the numbers live, and what's gated

`src/lib/test/perf/baseline.json` holds the exact numbers and the machine spec. It is the source of truth; this document is not. The README's performance charts are generated from that baseline by `scripts/render-perf-chart.mjs` — a re-bless and a chart regeneration are one act, so the pictures cannot drift from the gate.

| Rows                                    | Status          | Enforced by                                                                                                          |
| --------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------- |
| `e2e` (keystroke latency)               | **Gated**       | `npm run perf:check` — every renderable shape at ≤1MB, plus the 10MB keystroke                                       |
| `counters` (structural amplification)   | **Gated**       | `amplification.test.ts`                                                                                              |
| `parse`, `snapshot*`, `ancestryRebuild` | **Report-only** | Dev references — environment-sensitive; read them as orders of magnitude, not targets (see baseline.json's own note) |

**Environment scaling.** Ceilings derive from baselines measured on the calibration machine. A slower environment scales the whole ceiling via `PERF_RUNNER_SCALE` instead of re-blessing baselines per host. Local runs stay unscaled — that's the tight gate. CI sets the scale in the workflow from its measured slowdown, which makes the CI perf job a gross-regression net rather than a precision instrument; that job measures the production build (`perf:check:prod`).

## Key architectural decisions

**Container raw materialization.** Container nodes keep their full materialized outer source text. That spends memory on the amplification axis to buy it back on the undo axis, via structural-sharing undo. The amplification is linear and bounded at realistic sizes, whereas the only budget-busting cliffs — clone time proportional to node count, and a multi-GB undo-stack heap — both sat on the undo axis, and clone-on-write keyed by child ids eliminates both. Deriving container raw instead would fix the cheap problem and leave the expensive one. The 0.9.27 falsification benchmark (the combined depth-x-size axis in `container-raw.bench.ts`) is the standing evidence: realistic deep nesting pays ~1-2 ms/keystroke of ancestry rebuild — floor class — with the superlinear tail confined to adversarial shapes.

**Keystroke-latency attribution.** The dominant steady-state keystroke cost is framework reactive-flush work proportional to the number of **mounted** components. It sits outside every editor seam — only the edited block re-renders, and parse, inline refresh, ancestry rebuild, and snapshot each run about one unit — yet it scales linearly with mounted block count. The only lever that turns O(mounted) into O(viewport) is to genuinely unmount off-screen blocks. Hence virtual rendering.
