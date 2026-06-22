# Editor Performance

## Scale claims

Qualitative shape (exact numbers live in `baseline.json`, below):

- **Keystroke latency is O(viewport).** Single-digit milliseconds on realistic documents, and stays bounded into the 10MB range because virtual rendering windows the mounted component set to what's on screen.
- **Document load is roughly linear** in document size.

One keystroke axis is deliberately **not** viewport-bounded — recorded as a reference, not gated:

- **Intra-block long-paragraph editing** — a single block's span rebuild scales with paragraph length; windowing windows blocks, not the interior of one block.

Document **load** is O(document size): the reactive tree is materialized up front (`$state`-proxying every node, id assignment, height seeding) — script-bound and linear in node count, sub-second at realistic sizes, multi-second only at the hundreds-of-thousands-of-blocks extreme. Windowing bounds the _mount_ at load, not this materialization.

A flat high-block-count keystroke cost was once recorded here as an O(top-level-count) axis. Measurement showed it was a **harness artifact** — the latency harness summed the whole `$state`-proxy children array on every settle poll — not editor work. Flat-document keystrokes are O(viewport) like every other shape.

## Where the numbers live, and what's gated

`src/lib/editor/test/perf/baseline.json` holds the exact numbers and the machine spec — the source of truth.

- **Gated:** `npm run perf:check` enforces the keystroke (`e2e`) rows — every renderable shape at ≤1MB and the 10MB keystroke (all O(viewport), flat and single-container alike); `amplification.test.ts` asserts the structural `counters`.
- **Report-only:** the `parse` / `snapshot*` / `ancestryRebuild` rows are dev references — environment-sensitive (orders of magnitude, not targets; see baseline.json's note).

## Key architectural decisions

**Container raw materialization.** Container nodes keep their full materialized outer source text; the cost is spent on the undo axis instead, via structural-sharing undo. The amplification this costs is linear and bounded at realistic sizes, whereas the only budget-busting cliffs (clone time proportional to node count; multi-GB undo-stack heap) sat on the undo axis — and clone-on-write keyed by child ids eliminates both. Deriving container raw instead would fix the cheap problems and leave the expensive one.

**Keystroke-latency attribution.** The dominant steady-state keystroke cost is framework reactive-flush work proportional to the number of **mounted** components — it sits outside every editor seam (only the edited block re-renders; parse, inline refresh, ancestry rebuild, and snapshot each run ~one unit) yet scales linearly with mounted block count. The only lever that turns O(mounted) into O(viewport) is to genuinely unmount off-screen blocks: virtual rendering, shipped in the 0.8.6 VR work.
