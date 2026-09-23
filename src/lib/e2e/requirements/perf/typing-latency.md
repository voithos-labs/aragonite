# Feature: E2E Perf, Fixture Load + Typing Latency

Measures end-to-end editor responsiveness through the real browser pipeline:
wall-time to load each deterministic fixture (shape × 100KB/1MB/10MB) and
per-keystroke latency while typing into the loaded document. Gated behind
`PERF` (`PERF=1 npm run perf:e2e`); without it every test skips in seconds.

**Caveat:** rows run against the dev server with the dev-mode invariant assertions
active, so all numbers are conservative upper bounds on production latency,
not production latencies. The caveat is embedded in every result artifact.
The gate (`perf-gate.md`) measures a production build instead, so a report row
and the gated row for the same shape are not comparable numbers.

## Measurements

- fixture load: wall-time from `setSource` to the CST reflecting the fixture
  plus a render flush, for every shape × size
- per-keystroke latency: 30 real keystrokes (15 at 10MB, where second-scale
  latencies stabilize with fewer samples) typed one at a time; each keystroke
  waits on a check of the CST's document length through the test bridge (never
  `waitForTimeout`), reported as p50/p95
- caret target: end of block 0, except shapes whose first block is a container
  (nested-containers, table-heavy). Those type into an appended plain
  paragraph, since the caret helper cannot enter containers and table-cell
  edits re-pad the table, which breaks the +1-length wait. The dominant
  per-keystroke cost (the inline sweep over the whole document) does not depend
  on where the caret is; the cost of rebuilding a block's ancestors is measured
  directly by the vitest bench.
- cost of the check itself: document length is summed from top-level raw
  lengths, O(top-level blocks) per poll, because serializing the source on every
  poll at 10MB would dwarf the latency being measured

## Structural edits (report companion to the gated row)

One row alternates a top-level Enter at the end of block 0 and the Backspace that merges the new
block back, 16 edits on flat-prose at 10MB, each timed to the top-level block count changing.
It writes the result a re-bless of the gated `flat-prose-10MB-structural` row reads.

## At-depth typing (report-only)

One row types into the deepest leaf of a deep-nested document (`generateDeepNested`,
depth 8 × 50KB/level), so each keystroke pays the full rebuild of its ancestors' raw that
top-level rows skip. Report-only, with no gate and no baseline judgment: it is the
browser-side corroboration of the vitest ancestry-rebuild bench (concern 4). The caret lands at
the leaf via `focusBlockAtPath(deepNestedLeafPath(depth), …)`; the keystroke waits on block 0's
raw length, since the ancestry rebuild carries the typed character up to the root container. A
leaf the nested windowing left off-window fails the row through a mounted check rather than
recording a bogus latency.

## Installed inline handlers (report-only)

Four rows measuring what a registered inline syntax handler costs, which no standing row can see:
the editor route installs no plugins, so every ceiling is a number from an empty registry.
Report-only, no gate, no baseline judgment. Each row loads its fixture twice, 30
keystrokes, at 100KB (the footnote row also at 1MB): once on `/test/plugins` where the
handler is installed, once on the editor route where it is not, so the artifact carries both
numbers and their difference.

- bracket-dense under footnotes (`?seed=footnotes`): every paragraph carries inline
  links plus a `[^label]` reference, so each `[` in a scanned range pays for the handler being
  consulted on its prefix. This row measures two mechanisms on one fixture: the second is
  the mounted reference's number, which is worked out again from a pass over the whole document
  on every content version. A row that mounted no reference widget fails rather than
  reporting one mechanism as two.
- colon-dense under emoji (`?seed=emoji`): colons that mostly decline (`Note:`,
  `ns::method`, clock times) plus one real shortcode per paragraph, since the handler's
  cost is dominated by attempts that fail.
- dollar-dense under latex (base plugins): shell-documentation prose (the
  `$HOME`/`$PATH`/`$USER` shape) with one real math span in the first paragraph, which
  is also the row's proof the handler is installed.
- the footnote row again at 1MB, the only row with a size axis: its two mechanisms scale
  differently, since being consulted is bounded by the scanned range while the mounted widget's
  number comes from a pass over the document, so a 10× document at the same viewport separates
  them without a second fixture. A mounted count unchanged across the two sizes is what makes
  the growth attributable to the document rather than to the widgets reading it.
- plain prose under an installed handler on an unreserved character (`?seed=emoji`): ordinary
  prose with no trigger in it at all. `:` is held out of `SPECIAL_CHARS`, so registering emoji
  turns on `needsScan`'s per-character check for the whole document, the cost of giving up that
  the standing ceilings are blindest to. That the handler is installed is shown by a `:tada:`
  document loaded before the fixture, since plain prose creates no widget.

**Confound, recorded because no route here is a clean control:** `/test/plugins`
installs eight base plugins, two of which derive over the whole document, so the difference
between the two routes is an upper bound on an installed handler's cost rather than the
handler's cost alone.

## Vertical arrival (report-only)

Two rows time an arrow instead of a keystroke: ArrowDown into a paragraph of 200 decoded
entities from the prose line above it, and ArrowUp into it from the prose line below, each
sample waiting on the caret reaching that paragraph, 15 of each, reported as p50/p95. The caret
goes back to the line it left by a placement between samples, since an arrow out of a
multi-line paragraph can stop on a line inside it. In `arrival-widget-only` no caret position
in the paragraph has a box of its own, so the column the arrow carries is matched against the
widgets' boxes alone, and the row shows that scan staying on one line. `arrival-mixed` puts one
letter before the same entities, which gives the scan a box of its own to set the edge by, and
the row shows each widget measured once rather than at every byte of its source.

- a paragraph that did not mount all 200 widgets fails the row rather than timing a shorter one

## Sizes

All shapes run at 100KB / 1MB / 10MB, with nothing capped. The giant-single
shapes (list/blockquote/table) were uncapped at 0.8.5: their 10MB load is linear and
windowing bounds the mount, so the keystroke is O(viewport). reference-heavy was
uncapped at 0.8.5 too, once computing `inlineContent` lazily removed the whole-document
inline sweep per edit that made its keystroke fail to settle. Container-first shapes
(nested-containers, table-heavy, and the three giant-single shapes) prepend a
plain paragraph as the block-0 caret target, since `focusBlockEnd(0)` on a giant
container would target an unmounted child. (Headline numbers: `baseline.json`.)

One axis is not bounded by the viewport, and so is recorded but not regression-gated
at 10MB: single-giant-paragraph, whose span rebuild inside the block is O(paragraph
length) rather than O(viewport). The flat shapes with many top-level blocks
(flat-prose / many-small-blocks / reference-heavy) gate at 10MB: their keystroke carries no
O(top-level-count) cost, and the earlier belief that it did came from the harness, whose
per-keystroke wait summed document length over the whole children array. Which rows gate, and on
what budget, is `perf-gate.md`.

## Artifacts

- one JSON line per row on stdout (`PERF {...}`)
- `perf-results/e2e-<shape>-<size>.json` per row (gitignored raw output)
- curated headline numbers live in `src/lib/test/perf/baseline.json`
  under the `e2e` key

## Bridge sanity

- perf bridge round-trip: enabling instruments via `__test.perf`, typing one
  character in a small document, and polling past the debounced input flush
  yields `inlineComputeCount >= 1`: the first end-to-end check that the edited
  block's inline recompute is recorded in the perf counters

## Error cases

- a keystroke whose CST commit never lands fails the row when the wait times out
  rather than recording a bogus latency
- a fixture that cannot finish loading within the load budget fails the row
  when the wait times out rather than hanging the suite
