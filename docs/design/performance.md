# Editor Performance

## The one idea

**The editor only mounts what you can see.** A 10MB document and a 10KB document have the same number of live components on screen, so typing costs the same in both. That is virtual rendering (`docs/design/virtual-rendering.md`), and nearly every performance property below is downstream of it.

The exceptions are the two axes windowing can't reach — loading a document, and editing inside one enormous block — and both are called out here on purpose.

## Scale claims

Qualitative shape; the exact numbers live in `src/lib/test/perf/baseline.json`.

- **Keystroke latency is O(viewport).** Single-digit milliseconds on realistic documents, and it stays bounded into the 10MB range because windowing caps the mounted component set at what's on screen.
- **Document load is O(document size).** The reactive tree is materialized up front — `$state`-proxying every node, assigning ids, seeding heights — which is script-bound and linear in node count. Sub-second at realistic sizes; multi-second only at the hundreds-of-thousands-of-blocks extreme. Windowing bounds the _mount_ at load, not this materialization. The only lever is lazy or shallow proxying of the node tree, an architectural change deferred until a workload needs it.

One keystroke axis is deliberately **not** viewport-bounded, and is recorded as a reference rather than gated:

- **Intra-block long-paragraph editing.** A single block's span rebuild scales with paragraph length — windowing windows blocks, not the interior of one block. It is transient: any Enter splits the paragraph into viewport-bounded blocks, so it only surfaces from pasting a multi-MB blob into one block. The lever, if a real workload ever needs it, is intra-block DOM reconciliation of the rebuilt span run.

A flat high-block-count keystroke cost was once recorded here as an O(top-level-count) axis. Measurement showed it was a **harness artifact** — the latency harness summed the whole `$state`-proxy children array on every settle poll — not editor work. Flat-document keystrokes are O(viewport) like every other shape.

## Where the numbers live, and what's gated

`src/lib/test/perf/baseline.json` holds the exact numbers and the machine spec. It is the source of truth; this document is not. The README's performance charts are generated from that baseline by `scripts/render-perf-chart.mjs` — a re-bless and a chart regeneration are one act, so the pictures cannot drift from the gate.

| Rows                                    | Status          | Enforced by                                                                                                          |
| --------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------- |
| `e2e` (keystroke latency)               | **Gated**       | `npm run perf:check` — every renderable shape at ≤1MB, plus the 10MB keystroke                                       |
| `counters` (structural amplification)   | **Gated**       | `amplification.test.ts`                                                                                              |
| `parse`, `snapshot*`, `ancestryRebuild` | **Report-only** | Dev references — environment-sensitive; read them as orders of magnitude, not targets (see baseline.json's own note) |

**Environment scaling.** Ceilings derive from baselines measured on the calibration machine. A slower environment scales the whole ceiling via `PERF_RUNNER_SCALE` instead of re-blessing baselines per host. Local runs stay unscaled — that's the tight gate. CI sets the scale in the workflow from its measured slowdown, which makes the CI perf job a gross-regression net rather than a precision instrument.

## Key architectural decisions

**Container raw materialization.** Container nodes keep their full materialized outer source text. That spends memory on the amplification axis to buy it back on the undo axis, via structural-sharing undo. The amplification is linear and bounded at realistic sizes, whereas the only budget-busting cliffs — clone time proportional to node count, and a multi-GB undo-stack heap — both sat on the undo axis, and clone-on-write keyed by child ids eliminates both. Deriving container raw instead would fix the cheap problem and leave the expensive one. The 0.9.27 falsification benchmark (the combined depth-x-size axis in `container-raw.bench.ts`) is the standing evidence: realistic deep nesting pays ~1-2 ms/keystroke of ancestry rebuild — floor class — with the superlinear tail confined to adversarial shapes (`docs/research/architecture-concerns.md` entry 4).

**Keystroke-latency attribution.** The dominant steady-state keystroke cost is framework reactive-flush work proportional to the number of **mounted** components. It sits outside every editor seam — only the edited block re-renders, and parse, inline refresh, ancestry rebuild, and snapshot each run about one unit — yet it scales linearly with mounted block count. The only lever that turns O(mounted) into O(viewport) is to genuinely unmount off-screen blocks. Hence virtual rendering.
