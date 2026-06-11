# 0.7.4 — Container-Raw Decision Memo

**Status: decided 2026-06-11 — structural-sharing undo (recommendation accepted); implementation pending.** The revisit ladder for the materialized-raw axis (lazy raw, then fully derived) is recorded in `docs/roadmap.md` § 0.7.4.

Numbers come from the 0.7.7 harness baseline (`src/lib/editor/test/perf/baseline.json`, AMD Ryzen 7 7700, Node 24) plus one-off measurements run for this memo (scratch benches, deleted after recording; same machine). Bench rows are mean ms ± relative margin of error (sample count).

## Question

Container nodes materialize their full outer source text (`raw`) alongside their children's — every nesting level stores its subtree's text again — and every undo checkpoint deep-clones the whole document. Candidates (spec § Phase C, criteria verbatim):

| Candidate               | Wins if                                                                       | Cost moves to                                                              |
| ----------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| justified keep          | no fixture shows a cliff (superlinear or budget-busting hot-path/memory cost) | — (sync-before-rebuild already structural via G1.1, shipped 0.7.2)         |
| derived container raw   | live storage or rebuild amplification cliffs                                  | serialize + mid-edit container-raw reads (paste targeting, merge)          |
| structural-sharing undo | clone bytes / undo memory cliffs                                              | clone-on-write complexity at the `cloneNode` boundary, keyed by `childIds` |

Decision axis: amplification-on-write (materialized raw, re-clone per checkpoint) vs cost-on-read (derived raw moves cost onto serialize and mid-edit container-raw reads).

## Row 1 — live container-raw storage

Amplification = Σ(container `raw` length) ÷ serialized doc length, in UTF-16 code units (machine-independent counter). It counts the string content containers hold that a derived representation would hold nowhere — leaves already carry all content.

| Fixture                          | Amplification | Container-raw strings held |
| -------------------------------- | ------------- | -------------------------- |
| nested-containers 100KB/1MB/10MB | ×3.55 (all)   | 0.36 / 3.55 / 35.5 MB      |
| table-heavy 100KB/1MB            | ×1.96         | 0.20 / 1.96 MB             |
| single 10MB flat list (one-off)  | ×2.00         | 20.0 MB                    |

10MB-nested and flat-list rows are one-off confirmations; the rest are baseline counters. The factor is **scale-invariant per shape** — linear in doc size, never superlinear. At 10MB nested, ~10MB of the 35.5MB is the top-level copy today's serialize reads directly; the rest is inner-level duplication.

## Row 2 — ancestry rebuild per keystroke

Every keystroke inside a container re-joins each ancestor's raw, innermost first (`baseline.json` → `ancestryRebuild`):

| Bench                              | Mean ms | rme   | Samples |
| ---------------------------------- | ------- | ----- | ------- |
| depth 8, many tiny lists (1MB doc) | 0.0015  | ±9.0% | 342,180 |
| breadth: single 100KB list         | 0.149   | ±0.7% | 3,354   |
| breadth: single 1MB list           | 2.04    | ±4.1% | 246     |
| breadth: single 10MB list          | 23.1    | ±3.8% | 130     |

Depth is free; cost is O(size of the largest rebuilt container). One 10MB flat list costs 23.1ms **per keystroke** — alone above a 16ms frame — and each rebuild also allocates a fresh container-raw string of the container's full size (~10MB of churn per keystroke on that shape). At 1MB the same shape costs 2.0ms — inside budget.

Scope note: the e2e rebuild-depth histogram covers structural ops only (routine typing rebuilds through per-component `rebuildRaw` callbacks, not `rebuildAncestryRawForLeaf`); this vitest bench is the per-keystroke source of truth, and the per-container join cost is identical on either path.

## Row 3 — undo clone per checkpoint

A checkpoint fires on the first keystroke of each typing batch (250ms debounce) and on every structural op; each deep-clones the document. Baseline rows run under DEV (vitest), which adds the clone-safe-metadata invariant per metadata-bearing node; re-measured with `NODE_ENV=production` + `--mode production` (flips `import.meta.env.DEV` off):

| Fixture                     | DEV mean ms | Production mean ms (±rme, samples) |
| --------------------------- | ----------- | ---------------------------------- |
| nested-containers 100KB     | 3.45        | 2.87 (±0.67%, 175)                 |
| nested-containers 1MB       | 38.6        | 32.1 (±1.14%, 16)                  |
| nested-containers 10MB      | 403         | 357 (±5.25%, 10)                   |
| table-heavy 10MB            | 243         | 229 (±9.97%, 14)                   |
| flat-prose 10MB             | 15.4        | 13.4 (±0.83%, 225)                 |
| single-giant-paragraph 10MB | 0.0001      | 0.0001                             |

DEV overhead is ~10–15%; the cliff is intrinsic, not a test-mode artifact.

Clone cost is **O(node count), not bytes**: a 10MB single paragraph (1 node) clones in 0.1µs because strings copy by reference, while 10MB nested (585,936 nodes) takes 357ms. One-off: a single 10MB flat list (1.44M nodes — a shape not in the committed corpus) clones in ~812ms (DEV).

**What the undo gauge does and does not measure.** `undoLiveBytes` sums a serialized-length proxy per snapshot; at the `MAX_UNDO = 200` entry cap (entries, not bytes) it reads 200 × doc length — 200MB at 1MB, 2.0GB at 10MB. That is **not** heap: post-clone, every string is a shared reference, so a snapshot's real heap cost is its node _objects_. Measured retained heap per snapshot (one-off, process-heap delta over retained clones, no forced GC — approximate):

| Fixture                | Nodes     | Heap per snapshot | ≈ per node |
| ---------------------- | --------- | ----------------- | ---------- |
| nested-containers 1MB  | 58,608    | 12.1 MB           | 217 B      |
| nested-containers 10MB | 585,936   | 95.1 MB           | 170 B      |
| table-heavy 1MB        | 87,660    | 9.1 MB            | 109 B      |
| flat-prose 10MB        | 55,893    | 12.1 MB           | 227 B      |
| single 10MB flat list  | 1,444,447 | 226.5 MB          | 164 B      |

Strings diverge between checkpoints only along the mutated spine: +882B per checkpoint on the nested fixture's tiny lists, but ~10MB per checkpoint on the single-10MB-list shape (each rebuild replaces the whole list raw; the previous snapshot retains the old one).

At-cap arithmetic (sustained editing saturates 200 entries): nested 1MB ≈ 200 × 12.1MB ≈ **2.4GB** of object heap; nested 10MB ≈ 19GB — OOM long before cap (~40 checkpoints reach a typical ~4GB heap limit). The gauge proxy understates heap for node-heavy shapes and overstates it for string-heavy flat ones — treat it as a serialized-volume regression tracker, not a memory meter.

## Candidate simulations (one-off)

| Measurement                                                           | nested 1MB | nested 10MB | single 10MB list |
| --------------------------------------------------------------------- | ---------- | ----------- | ---------------- |
| full `cloneDocument` (same-run reference, DEV)                        | 43.4 ms    | 400 ms      | 812 ms           |
| spine-only clone (copy path to edit, share off-spine children by ref) | 0.0072 ms  | 0.137 ms    | 0.60 ms          |
| reduction                                                             | ~6,000×    | ~2,900×     | ~1,400×          |
| bottom-up derive of every container raw (derived-raw cold serialize)  | 11.5 ms    | 101 ms      | 206 ms           |

Today's serialize is a top-level O(doc bytes) join — a few ms at 10MB. Under derived raw, a mid-edit read of one container is a recursive derive of its subtree: µs for the nested fixture's tiny lists, ~206ms for the pathological single 10MB list (the same cliff as Row 2, paid per read instead of per keystroke).

## Criteria applied

**justified keep — "no fixture shows a cliff (superlinear or budget-busting hot-path/memory cost)": fails.** Nothing measured is superlinear, but two budget-busting hot-path/memory costs exist: (a) undo clone at 357ms per checkpoint @10MB nested and 32ms @1MB (production), with per-snapshot heap of 12MB @1MB → ~2.4GB at stack cap on a realistic 1MB document; (b) per-keystroke breadth rebuild at 23.1ms on a 10MB single container — over frame budget, though only on a shape that already cannot render. G1.1 made sync-before-rebuild structural, so keep would require no work — but its own criterion is not met.

**derived container raw — "live storage or rebuild amplification cliffs": not selected by the evidence.** Live storage is a scale-invariant constant factor (×3.55 / ×1.96 / ×2.0) — 3.55MB extra at 1MB nested, 35.5MB at 10MB; linear, and small next to undo-stack heap. The rebuild axis cliffs only when a _single_ container approaches MB size: 2.0ms @1MB is in budget, and the 23.1ms @10MB shape is unreachable interactively (render wall). The move would cost: serialize goes from a few ms to 101–206ms @10MB (off the keystroke path), mid-edit container-raw reads go from O(1) to a subtree derive, and G1.1 plus the syntax-tree/editor/invariants contract sections reshape. Decisive against it: the measured cliffs are node-count-bound clone time and snapshot heap, which derived raw does not touch at all.

**structural-sharing undo — "clone bytes / undo memory cliffs": selected.** Both cliffs on this axis are measured and budget-busting at realistic sizes: 32ms (1MB) / 357ms (10MB) per checkpoint in production, and object-heap retention reaching GBs at the entry cap on a 1MB nested document. The spine-only simulation removes ~99.97% of per-checkpoint time (0.0072ms @1MB, 0.137ms @10MB) and turns per-checkpoint heap from ~0.1–0.25KB × all nodes into O(depth + touched-container children) — KBs to a few MB. What sharing does **not** fix: per-checkpoint _string_ divergence on giant-single-container shapes (~10MB retained per checkpoint on the 10MB flat list) — that residual lives on the materialized-raw axis, not the undo axis.

## Recommendation

**Adopt structural-sharing undo; keep materialized container raw (a justified keep on the representation axes).**

The evidence sorts cleanly along the spec's axis: amplification-on-write is real but linear and bounded on the storage/rebuild axes at realistic sizes (≤1MB: 3.55MB extra storage, 2ms/keystroke worst-case rebuild), while the undo axis holds the only budget-busting costs at those sizes — a 32ms stall at every typing-batch start and structural op, and a path to multi-GB heap at the undo cap. Clone-on-write keyed by `childIds` eliminates effectively all of both. Derived raw would fix the cheap problems and leave the expensive one.

Cost accepted: clone-on-write complexity at the `cloneNode` boundary — concretely, mutation discipline. Once snapshots alias live subtrees, every in-place mutation (commit primitives _and_ the per-component `rebuildRaw` callbacks) must copy shared spine nodes before writing or it corrupts history. The implementation plan's central risk is silent aliasing; it needs an aliasing invariant plus fuzz coverage (the 0.7.5 harness is the natural home).

Residual risk of the non-chosen candidates:

- **Not choosing derived raw:** the ×3.55 live storage stays (3.55MB @1MB; 35.5MB @10MB, currently unrenderable); per-keystroke breadth rebuild stays O(largest container) with ~10MB/keystroke string churn on giant-single-container shapes; and per-checkpoint spine-string retention on those shapes (~10MB/snapshot) is not fixed by sharing. If 0.8's diagnosis shows giant single containers matter interactively, revisit derived raw then — the G1.1 reshape goes with it.
- **Not choosing plain keep:** only the cost of doing the work — keep leaves both measured undo cliffs in place. (Orthogonal stopgap available under any candidate: cap the undo stack by gauge bytes or node count instead of entries — bounds memory by sacrificing undo depth; a mitigation, not a resolution.)

Seam note: this choice leaves the serialization/rebuilder contract untouched, so the 0.8.3 schema/node-spec seam is unblocked once the decision lands; G1.1 keeps its current shape.

## What 0.7.4 does not fix

- **The undiagnosed keystroke cost.** Post-0.7.7 scoping, nested 1MB still settles a keystroke in ~1.16s e2e, and reference-heavy 10MB cannot settle one keystroke in 60s. The inline sweep was ruled out as dominant, and the rows this memo owns cannot account for it either (rebuild 2ms; clone 32ms, batch-start only). No container-raw candidate owns this; it is a 0.8 measurement item — diagnose before attributing.
- **The 10MB render wall.** Three fixture shapes never finish loading at 10MB; lazy/virtual rendering (Track C) owns that. No candidate here changes it.

## Measurement caveats

1. DEV-mode clone inflation: resolved by direct production-mode measurement (Row 3) — ~10–15% delta, relative candidate comparison unaffected.
2. Under profiling, the DEV stale-raw check parses per committed strip-container, polluting `parseCount`/`parseMsTotal` attribution. Bench rows are unaffected (they call the functions directly).
3. e2e rebuild-depth histograms under-sample typing (Row 2 scope note); the vitest breadth bench is the per-keystroke source of truth.
4. Heap-per-snapshot numbers are process-heap deltas without forced GC — approximate, but the per-node cost is consistent (0.1–0.25KB) across five shapes.
