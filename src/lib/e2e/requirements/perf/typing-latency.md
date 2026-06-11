# Feature: E2E Perf — Fixture Load + Typing Latency

Measures end-to-end editor responsiveness through the real browser pipeline:
wall-time to load each deterministic fixture (shape × 100KB/1MB/10MB) and
per-keystroke latency while typing into the loaded document. Gated behind
`PERF` (`PERF=1 npm run perf:e2e`); without it every test skips in seconds.

**Caveat:** rows run against the dev server with DEV invariant assertions
active, so all numbers are conservative upper bounds on production latency,
not production latencies. The caveat is embedded in every result artifact.

## Measurements

- fixture load: wall-time from `setSource` to the CST reflecting the fixture
  plus a render flush, for every shape × size
- per-keystroke latency: 30 real keystrokes (15 at 10MB — second-scale
  latencies stabilize with fewer samples) typed one at a time; each keystroke
  settles on a CST doc-length bridge predicate (never `waitForTimeout`),
  reported as p50/p95
- caret target: end of block 0, except shapes whose first block is a container
  (nested-containers, table-heavy) — those type into an appended plain
  paragraph, since the caret helper cannot enter containers and table-cell
  edits re-pad the table, breaking the +1-length settle. The dominant
  per-keystroke cost (the whole-doc inline sweep) is caret-position-independent;
  ancestry-rebuild cost is measured directly by the vitest bench.
- settle predicate cost: doc length is summed from top-level raw lengths —
  O(top-level blocks) per poll — because serializing the source per poll at
  10MB would dwarf the latency being measured

## Capped rows (probed 2026-06-10)

10MB rows exist only for flat-prose and single-giant-paragraph. Capped at 1MB:

- many-small-blocks, nested-containers, table-heavy — load never completes
  (the renderer cannot materialize that many DOM blocks/cells; lazy rendering
  is roadmapped, 0.7 Track C)
- reference-heavy — loads, but a single keystroke fails to settle within 60s
  (per-edit whole-doc inline sweep over ~65k reference-bearing blocks; the
  dirty-set scoping item targets exactly this)

## Artifacts

- one JSON line per row on stdout (`PERF {...}`)
- `perf-results/e2e-<shape>-<size>.json` per row (gitignored raw output)
- curated headline numbers live in `src/lib/editor/test/perf/baseline.json`
  under the `e2e` key

## Bridge sanity

- perf bridge round-trip: enabling instruments via `__test.perf`, typing one
  character in a small document, and polling past the debounced input flush
  yields `inlineRefreshCount >= 1` — the first end-to-end check that the
  editor's inline-sweep seam records into the perf counters

## Error cases

- a keystroke whose CST commit never lands fails the row via settle timeout
  rather than recording a bogus latency
- a fixture that cannot finish loading within the load budget fails the row
  via settle timeout rather than hanging the suite
