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

## At-depth typing (report-only)

One row types into the DEEPEST leaf of a deep-nested document (`generateDeepNested`,
depth 8 × 50KB/level), so each keystroke pays the full ancestry raw rebuild that
top-level rows skip. Report-only — no gate, no baseline judgment — the browser-side
corroboration of the vitest ancestry-rebuild bench (concern 4). Caret lands at the
leaf via `focusBlockAtPath(deepNestedLeafPath(depth), …)`; the keystroke settles on
block 0's raw length, since the ancestry rebuild propagates the typed character to
the root container. A leaf the nested windowing left off-window fails the row via a
mounted check rather than recording a bogus latency.

## Installed inline rungs (report-only)

Four rows measuring what a REGISTERED inline rung costs, which no standing row can see:
the editor route installs no plugins, so every ceiling is an empty-registry number.
Report-only, no gate, no baseline judgment. Each row loads its fixture twice, 30
keystrokes, at 100KB (the footnote row also at 1MB): once on `/test/plugins` where the
rung is installed, once on the rung-free editor route, so the artifact carries both
numbers and their delta.

- bracket-dense under footnotes (`?seed=footnotes`): every paragraph carries inline
  links plus a `[^label]` reference, so each `[` in a scanned range pays the rung's
  prefix consultation. This row measures TWO mechanisms on one fixture — the second is
  the mounted reference's number, which re-derives from a walk over the whole document
  on every content version. A row that mounted no reference widget fails rather than
  reporting one mechanism as two.
- colon-dense under emoji (`?seed=emoji`): colons that mostly decline (`Note:`,
  `ns::method`, clock times) plus one real shortcode per paragraph, since the rung's
  cost is dominated by attempts that fail.
- dollar-dense under latex (base plugins): shell-documentation prose (the
  `$HOME`/`$PATH`/`$USER` shape) with one real math span in the first paragraph, which
  is also the row's proof the rung is live.
- the footnote row again at 1MB, the only row with a size axis: its two mechanisms scale
  differently — the consultation is bounded by the scanned range while the mounted
  derivation walks the document — so a 10× document at the same viewport separates them
  without a second fixture. A mounted count unchanged across the two sizes is what makes
  the growth attributable to the document rather than to the readers.
- plain-prose under an installed unreserved rung (`?seed=emoji`): ordinary prose with
  no trigger in it at all. `:` is held out of `SPECIAL_CHARS`, so registering emoji
  turns on `needsScan`'s per-character probe for the whole document — the bail cost
  the standing ceilings are blindest to. Its rung liveness comes from a `:tada:` probe
  document loaded before the fixture, since plain prose mints no widget.

**Confound, recorded because no route here is a clean control:** `/test/plugins`
installs eight base plugins, two of which derive over the whole document, so a route
delta bounds an installed rung's cost from ABOVE and is not attributable to the rung
alone. Building a rung-only route was rejected as out of proportion to a report row.

## Sizes

All shapes run at 100KB / 1MB / 10MB — nothing is capped. The giant-single
shapes (list/blockquote/table) un-capped at 0.8.5: their 10MB load is linear and
windowing bounds the mount, so the keystroke is O(viewport). reference-heavy
un-capped at 0.8.5 too — lazy inlineContent removed the per-edit whole-document
inline sweep that made its keystroke fail to settle. Container-first shapes
(nested-containers, table-heavy, and the three giant-single shapes) PREPEND a
plain paragraph as the block-0 caret target, since focusBlockEnd(0) on a giant
container would target a windowed-out child. (Headline numbers: baseline.json.)

One axis stays non-viewport-bounded, and so is recorded but not regression-gated
at 10MB: single-giant-paragraph, whose intra-block span rebuild is O(paragraph
length) rather than O(viewport). The flat high-top-level-block-count shapes
(flat-prose / many-small-blocks / reference-heavy) were once excluded for the same
reason, on the belief their keystroke carried an O(top-level-count) cost; that was
a harness artifact — the per-keystroke settle summed doc length over the whole
children array — and they gate at 10MB now. Which rows gate, and on what budget,
is `perf-gate.md`.

## Artifacts

- one JSON line per row on stdout (`PERF {...}`)
- `perf-results/e2e-<shape>-<size>.json` per row (gitignored raw output)
- curated headline numbers live in `src/lib/test/perf/baseline.json`
  under the `e2e` key

## Bridge sanity

- perf bridge round-trip: enabling instruments via `__test.perf`, typing one
  character in a small document, and polling past the debounced input flush
  yields `inlineComputeCount >= 1` — the first end-to-end check that the edited
  block's inline recompute records into the perf counters

## Error cases

- a keystroke whose CST commit never lands fails the row via settle timeout
  rather than recording a bogus latency
- a fixture that cannot finish loading within the load budget fails the row
  via settle timeout rather than hanging the suite
