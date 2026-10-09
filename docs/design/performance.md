# Editor Performance

The tour:

1. [The one idea](#the-one-idea): why typing cost doesn't grow with document size, and the exceptions this doc refuses to hide.
2. [Scale claims](#scale-claims): what a keystroke and a load cost, qualitatively.
3. [The four axes windowing does not bound](#the-four-axes-windowing-does-not-bound): the exceptions, current numbers first.
4. [Costs beside the keystroke rows](#costs-beside-the-keystroke-rows): selection coverage, toolbar reads, and kind re-derivation.
5. [The numbers and the gate](#the-numbers-and-the-gate): where the exact numbers live, the three commands, what's gated versus report-only, and why a red run on your machine is expected.
6. [Two architectural decisions](#two-architectural-decisions): why containers store their full source, and why windowing is the only lever that matters.

## The one idea

Typing costs the same in a 10KB document and a 10MB one, because the editor only mounts the blocks you can see (`docs/design/virtual-rendering.md`). Nearly every property below follows from that.

There are exceptions, and windowing reaches none of them: loading a document, editing inside one enormous block, and any derivation that walks the CST rather than the mounted set. Every one of them is called out below, with its numbers.

## Scale claims

Qualitative shape here; the exact numbers live in `src/lib/test/perf/baseline.json`, and [The numbers and the gate](#the-numbers-and-the-gate) says which of them are enforced.

- **A keystroke is O(viewport).** Single-digit milliseconds on realistic documents, and it stays bounded into the 10MB range because windowing caps the mounted component set at what's on screen. The four axes in the next section are the exceptions.
- **Load is O(document size).** The reactive tree is materialized up front (`$state`-proxying every node, assigning ids, seeding heights), which is script-bound and linear in node count. Sub-second at realistic sizes, multi-second only at the hundreds-of-thousands-of-blocks extreme. Windowing bounds the mount at load, not this materialization. The only lever is lazy or shallow proxying of the node tree, an architectural change deferred until a workload needs it.

## The four axes windowing does not bound

Four keystroke axes read something other than the mounted set. Their statuses differ: the first is recorded as a reference rather than gated, the second is gated at its own baseline, the third and fourth are measured and reported rather than gated.

### 1. Editing one long paragraph

A single block's span rebuild scales with paragraph length, because windowing windows blocks, not the interior of one block. It's transient: any Enter splits the paragraph into viewport-bounded blocks, so it only surfaces from pasting a multi-MB blob into one block. The lever, if a real workload ever needs it, is intra-block DOM reconciliation of the rebuilt span run. The inline scan itself holds linear across this axis, emphasis-dense shapes included, so the rebuild is the whole term.

### 2. Typing inside a large container

A container's `raw` (its verbatim source bytes, children included) holds its full outer source, so every keystroke inside the container has to keep that copy honest. The rebuild rewrites the changed child's region alone (`editor.md` § 9), reading one child instead of all of them. On the production build that's **3.3 ms** per keystroke for a 1MB single giant list, **3.0 ms** for a giant blockquote, **4.1 ms** for a giant table and **5.4 ms** for the 10MB list. The `giant-single-{list,blockquote,table}-interior` rows type inside the container and gate it. What's left on this axis is the tail join, the fourth axis below.

### 3. A live whole-document derivation

A reader keyed on the editor's **content version** (the counter that ticks whenever the document's bytes change) walks the CST, not the mounted set, so windowing can't bound it. The bundled footnote reference is the only reader today, and it's the reader that pays: with no `[^label]` widget mounted the cost is zero. O(document shape) rather than O(viewport). Measured, not gated.

The `rung-bracket-dense-footnotes` report rows type into a bracket-dense document with reference widgets in the viewport: **4.1 ms** p50 per keystroke at 100KB and **11.7 ms** at 1MB, against **2.7 ms** at both sizes for the identical bytes on the plain editor route, where no inline handler is installed. The mounted widget count is 20 at both sizes, since windowing bounds the mount, so the growth is the document, not the readers. Those rows were measured while the content version still came from a walk over every node (about 1.8 ms at 100KB and 18 ms at 1MB on its own), so read them as a ceiling for today's cost.

The reader keeps it this small by memoizing each top-level subtree's references against that subtree's `raw`, which is a sound witness because the `raw` of a container holds everything under it. So a keystroke re-parses the edited subtree and re-reads two fields per sibling (`raw`, `kind`): O(top-level count + edited subtree) instead of an inline parse per prose leaf.

### 4. A join under a large block

When an edit may have moved a join (where two blocks meet, blank lines or not), the editor asks whether they're still the blocks a reload reads there. That ask parses the block above the join whole, and the block below gets its first line read and no more. If a block opens on that line, it opens there in the full parse too, unless the block above's reading isn't final yet (next paragraph). A big table or a long paragraph right under a heading costs one line a keystroke, and so does one under a paragraph starting with a link or a closed `$$` block; `src/lib/test/perf/flush-join-read-cost.test.ts` pins those.

A reading isn't final when more lines could still change it. A lone `$$` hunts for its closing `$$` and turns into a paragraph without one, and a link definition with no title yet takes one from the next lines if a quote opens and closes there. So `$$` over `<div>` reads as two blocks, while `$$` over `<div>` and another `$$` reads as one math block, and cutting after one line gets that wrong. Each opener answers this for a block's own bytes (`readingNotFinal` on its registration), checking its first line before it scans the rest, and when the block above a join answers yes, the block below gets parsed whole. A closed `$$` block, a titled definition and `[a](b)` all answer no.

So a keystroke pays for the size of whatever sits right above the join it touches, plus a line. Two routes pay a lot of it today:

- a write in a container's last child, with a block right below the container (a list standing above indented code absorbs it, say): **~34-37 ms** per keystroke at ~650KB, against ~0.5 ms with the ask off. Tracked as issue #182.
- a write in a block flush under a big one, like a heading right under a giant list: every keystroke in the heading parses the list. `src/lib/test/perf/flush-join-read-cost.test.ts` pins the bytes (the list whole plus the heading's line), so a change here shows up as a changed row rather than a surprise.

It's the interior-typing axis's twin at the other end, and a different cost: the ask parses bytes where the rebuild read children, so the child spans do nothing for it. The gated fixtures are single top-level blocks, so no ceiling sees it. Reading only the part of the upper block that could still take the next line would bound it, but that's a correctness question of its own (a list item's bytes read as a list, a quote's tail doesn't read alone), so the whole block it is.

## Costs beside the keystroke rows

Four more costs are measured without being keystroke axes.

**What a range covers** gets worked out once per selection change (`rangeCoverage`, what the overlay paints from; a copy or a delete asks again when it runs). It walks every block the range covers, so it grows with the selection rather than the screen, but it grows linearly. Ctrl+Shift+End from the top of a 2MB single list (about 51k items) takes **~115 ms** in node, measured 2026-09-29, and `src/lib/test/selection/range-coverage-cost.test.ts` keeps it linear by pricing the same selection at N and 4N blocks. Not gated.

**The toolbar's cross-block pressed-state read** walks the selected range rather than the mounted set. It's memoised per (selection, content version) and answers every registered mark from one decomposition, so a four-button toolbar pays one pass per selection change instead of four: **3.6 ms** at 500 blocks and **12.7 ms** at 2000, node-measured over a document of 76-byte paragraphs each wholly covered by `strong`. The read was driven through `makeKeydownEnv`, the cross-block test harness, so the endpoints came off `SelectionState` the way production reads them; a harness that hands the read plain endpoint literals moves the absolutes several-fold. A shift-drag still pays it per event, every event being a new selection.

Over a grid the walk is per covered cell: a whole-table selection across a 180k-cell fixture reads in about 96 ms in node, and the toggle that follows it in about 446 ms. Not gated.

**The single-block half of that read** is memoised too, on the block's own bytes and the selection rather than a composed key, since the display there is the block's whole raw. A `selectionChange` fires on every keystroke, so a four-button toolbar over a large paragraph costs one coverage parse of that block instead of four, O(block) either way. No ceiling of its own; it rides the gated typing rows wherever a toolbar is mounted.

**The container kind re-derivation** parses the container's whole raw when its opener line's verdict moves (a typed `> [!TIP]` turning a blockquote into a GitHub alert). That's one parse per kind transition (~53 ms on a 1MB blockquote, against ~5 ms for the neighbouring keystrokes), and it's the feature doing its work, not an axis. Ordinary typing on an opener line never reaches it, because the check compares what the line opens as, not whether it changed. Where that does cost something:

- **An opaque container** (a `:::` directive, a diagram) reads its metadata from a parse of its bytes. An edit that moves its opener or closing line pays one parse of the container, which is what the keystroke that lengthens a fence costs. Typing in a titled directive's title moves the opener too, but skips the parse, because no metadata comes from the title row. Typing in the body moves neither line. `kind-rederive-gate.test.ts` counts all three on the keystroke's own route.
- **A list item or a quote** keeps its metadata on its first line, so a keystroke there reads that one line alone. It parses the item's own bytes only on the keystroke that changes what the marker reads as (a space typed right after `- `), and that parse is the size of the item, never the list; `strip-reread-cost.test.ts` counts the bytes.
- **A wider marker that moves lines out of the item** is the one case that reads more: the list then reads whole, and so does each container around it whose shape changed (a list in a quote reads the quote too).

**And flat documents**, since someone always asks: a keystroke there is O(viewport) like every other shape, unless a whole-document derivation is live (the third axis above). If a harness of yours says otherwise, check it isn't reading the whole `$state` children array while it waits for the edit to land: that once passed for an O(top-level count) axis.

## The numbers and the gate

`src/lib/test/perf/baseline.json` holds the exact numbers and the machine spec, and when this doc and that file disagree, the file is right. The README's performance charts are drawn from that file by `scripts/render-perf-chart.mjs`, and nothing runs it for you, so after a re-bless (recording fresh measurements as the accepted baseline) run `node scripts/render-perf-chart.mjs` too.

Three commands measure the editor over shared deterministic fixtures, and exactly one of them is a gate. Work out which one you're looking at before you panic about a number.

| Command               | Layer          | What it does                                                                                                               |
| --------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `npm run perf:editor` | bench (Vitest) | parse / clone / ancestry-rebuild / snapshot-push timings, written to `perf-results/`                                       |
| `npm run perf:e2e`    | browser        | fixture load wall-time plus per-keystroke p50/p95 through real Chromium; report only                                       |
| `npm run perf:check`  | **the gate**   | builds the app, previews it, and gates keystroke p50 against `baseline.json` on that production build; fails on regression |

The browser and gate scripts arm their own env switches (`PERF`, plus `PERF_GATE` and `PERF_PROD` for the gate). Outside them, in the full `npm test` suite for instance, the `e2e-perf` specs self-skip in seconds.

### What is gated, what is report-only

| Rows                                                                                                     | Status          | Enforced by                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `e2e` keystroke p50 (`GATED_ROWS` and `CONTAINER_INTERIOR_ROWS`)                                         | **Gated**       | `npm run perf:check`, over a production build; deliberate, not in `npm test`. Ceiling = baseline × 1.1 + 5 ms, × `PERF_RUNNER_SCALE` (1 locally, the tight gate; CI sets 2.5)                                                                                |
| `flat-prose-10MB-structural` (a top-level Enter and Backspace)                                           | **Gated**       | `npm run perf:check`, the same ceiling formula over the p50 per edit. A top-level split or merge rebuilds the whole windowing model, which no typed character does, so a change that makes one read the whole document reds this row                         |
| `caret-frame` rows A and B (the drawn caret lands with the letter, on the browser's caret box)           | **Gated**       | `npm run perf:check` and `perf:e2e`, as counts with no baseline, typing a key a frame into 1MB documents: zero frames where the drawn caret trails the letter by a pixel, a largest difference of a pixel, and zero frame paints that moved the bar          |
| `caret-frame` row C (moves the browser makes: arrows, ArrowDown in a block, clicks)                      | **Gated**       | The same runs, at most the blessed `caretFrame.browserMoves.lagFramesPerMove` lagging frames per move in `baseline.json`                                                                                                                                     |
| `counters` (structural amplification, clone byte parity, quote and list item line reads)                 | **Gated**       | Hard ceilings in `counters.test.ts`, inside the commit gate (`test:editor:perf`, which `npm test` runs); `amplification.test.ts` is its report-only sibling that logs the factors. Clone byte parity: a clone serializes to exactly its source's byte length |
| `parse`, `snapshot*`, `ancestryRebuild`                                                                  | **Report-only** | Nothing; dev references, environment-sensitive, read them as orders of magnitude, not targets (see baseline.json's own note)                                                                                                                                 |
| p95, and the `single-giant-paragraph` rows                                                               | **Report-only** | Nothing; p95 catches single GC-pause keystrokes and is noisy, and the giant paragraph is the first axis above                                                                                                                                                |
| `rung-*` (an installed inline syntax handler)                                                            | **Report-only** | Nothing; printed by `npm run perf:e2e`, skipped by the gate (why: below)                                                                                                                                                                                     |
| `arrival-widget-only`, `arrival-mixed` (an arrow into a paragraph of widgets, alone or after one letter) | **Report-only** | Nothing; printed by `npm run perf:e2e`, skipped by the gate. The two rows that time an arrow rather than a keystroke                                                                                                                                         |

A gated row and the ceiling the formula gives it, from the 2026-08-26 bless:

```ts
// baseline.json, e2e section
"flat-prose-1MB": { "loadMs": 72.3, "keystrokeP50Ms": 2.7, "keystrokeP95Ms": 6.4 }
// the gate's ceiling for that row's p50
(2.7 * 1.1 + 5) * PERF_RUNNER_SCALE; // 7.97 ms locally; 19.925 ms on CI, where the scale is 2.5
```

And the three counter ceilings, on the fixtures `counters.test.ts` uses (the first two run as written; the third is the gist, and the test has the setup):

```ts
const nested = parse(generateFixture('nested-containers', 100_000));
containerRawBytes(nested.children) / docByteLength(nested); // 3.55; the ceiling is 3.9
const tables = parse(generateFixture('table-heavy', 100_000));
containerRawBytes(tables.children) / docByteLength(tables); // 1.96; the ceiling is 2.2

// The deepest chain of generateDeepNested(8, 2_000) rebuilt in full, under the perf instruments,
// against the lines its quotes and list items hold: 4 reads over 80 lines.
perfSnapshot().stripLinesRead / linesInTheChain; // 0.05; the ceiling is 0.06
```

The third one is there because a quote or list item rebuild reads its own previous bytes, so the lines you didn't touch keep their spelling. A line already in the container's own spelling (`> ` and then the text, say) gets matched without being read at all, so on that fixture only the list items' opening lines get read. A rebuild that starts reading every line again is the kind of slowdown a report-only timing row lets through without a word.

The gated set, precisely (18 rows): flat-prose, nested-containers, reference-heavy, table-heavy and many-small-blocks at 1MB; flat-prose, many-small-blocks, reference-heavy and the three giant-single containers at 10MB; the container-interior rows (list, blockquote and table at 1MB, list at 10MB); two live-mode 1MB rows (flat-prose, nested-containers) ceilinged at their source twins; and the structural-edit row on flat-prose at 10MB. `single-giant-paragraph` is the one shape gated nowhere, being the axis. The caret-frame rows sit beside them, and they also print the drawn caret's paint time (`caretPaintMs`, from the first repaint request to the paint) and Event Timing's `keydown` to next paint, both report-only. Ceiling and baseline bumps are deliberate decisions, never a reflexive edit to make a red run go away.

### Environment scaling, and the red you will see

Ceilings derive from baselines measured on the calibration machine (the pinned dev machine `baseline.json` names). A slower environment scales the whole ceiling via `PERF_RUNNER_SCALE` instead of re-blessing baselines per host. Local runs stay unscaled, which is the tight gate. CI sets the scale in the workflow from its measured slowdown, which makes the CI perf job a gross-regression net rather than a precision instrument. Both run the same command.

**On any host that isn't the calibration machine, an unscaled `perf:check` reads red by design.** Measured 2.2-3.4x on pure JS on a laptop, and no single scale factor tracks that spread across rows. So when yours reads red, that's not you breaking the editor. Treat a non-pinned-host run as diagnostic, not as a regression signal.

### What `perf:check` actually gates

The dev machine is the pinned hardware, and same-machine run-to-run p50 spread is a few percent, so an absolute baseline plus tolerance catches regressions without a CI runner. It measures a production build, which is what makes the numbers the editor's rather than Vite's. A dev-server run measures Vite's transform overhead and Svelte's dev-only bookkeeping alongside the editor, and the container rows are how far apart those two readings can be. Re-bless the baseline after a Chromium/OS/toolchain bump moves the floor.

It gates **steady-state** p50, which means it's blind to a one-slow-keystroke regression: a single slow first-edit full re-render barely moves a 30-sample median. That class is guarded separately, by `block-render-scoping` inside the fast `npm test` gate, an e2e spec that reads the perf instruments to count how many blocks an edit re-rendered and fails when the count fans out.

### Why the `rung-*` rows report rather than gate

An inline syntax handler is a plugin's recognizer installed at one priority in the inline parser's ordered list, and the `rung-*` rows are what typing costs with one installed. Every other ceiling measures an _empty_ inline registry, because the editor route installs no plugins. These rows stay ungated for two reasons, both about what a ceiling would mean rather than about runtime:

1. The cost belongs to whichever plugin registered the trigger. A recognizer is the plugin's code, so a ceiling here would pin a number the editor doesn't own and would move under a plugin's own release.
2. No clean control exists. Each row measures its fixture twice, on `/test/plugins` where the handler is installed and on the plain editor route, but the plugins route also installs eight base plugins (two of them whole-document derivers), so the delta bounds a handler's cost from above and isn't attributable to the handler alone.

Each row records its mounted-widget count, so a row whose plugin silently stopped installing fails rather than reporting the control number as the handler's.

### Fixtures

`src/lib/test/perf/fixtures/generate.ts` builds nine seeded shapes at any byte target: flat-prose, nested-containers, many-small-blocks, single-giant-paragraph, reference-heavy, table-heavy, giant-single-list, giant-single-blockquote, giant-single-table. The same (shape, size, seed) always yields identical bytes, golden-pinned, so numbers stay comparable across runs and machines.

```ts
generateFixture('flat-prose', 1_000_000).slice(0, 40);
// '## juliet hotel november kilo\n\ncharlie i'   (NATO-alphabet prose, about a megabyte of it)
```

### Instruments

`src/lib/perf/instruments.ts` holds the dev-mode counters (snapshot clone bytes, a rebuild-depth histogram, parse timing, line reads, an undo live-byte gauge, and more; the snapshot below shows every one). Recording is off until enabled, and the switch only arms under dev/Vitest, so production pays one boolean check per record site. On `/test/editor` the test bridge exposes them as `__test.perf.enable()` / `.reset()` / `.snapshot()`, callable from DevTools or `page.evaluate`.

The shape a snapshot comes back in, from a node-side probe that parsed one 10KB fixture and computed one block's inline tree (the browser bridge hands you the same object, with the render, mount, and keystroke fields filled in):

```ts
perfSnapshot();
// {
//   snapshotCount: 0, snapshotCloneBytes: 0, rebuildDepths: {}, containerKindReparses: 0,
//   containerReparseBytes: 0, openerLineReads: 0, stripLinesRead: 0,
//   parseCount: 1, parseMsTotal: 0.3, parseBlockCount: 57, parseBytes: 10179, inlineComputeCount: 1,
//   formatCoverageReads: 0, screenReads: 0, undoLiveBytes: 0, undoEntryCount: 0,
//   blockRenderCount: 0, blockRenderMsTotal: 0, keystrokeInPageMs: [], caretPaintMs: [],
//   caretFrameMoves: 0, caretPaints: 0, blockRenderPaths: [],
//   mountedBlockCount: 0, decorationRuns: 0, islandRebuilds: 0, islandKeyScans: 0,
//   heightTableBuilds: [], neighbourPasses: 0
// }
```

The undo gauge is push-sampled: it updates only when a snapshot is pushed, and undo, redo, and clear don't refresh it. Read it as "live bytes as of the last push", not a live value.

### One caveat on every non-gate number

The bench and browser layers run under DEV (Vitest / dev server) with invariant assertions active, so every timing they print is a conservative upper bound on production, not a production latency. The real thing is faster than what you're reading, never slower. The gate is the exception: `perf:check` measures the production build.

## Two architectural decisions

**Container raw materialization.** Container nodes keep their full materialized outer source text. That spends memory on the amplification axis (the bytes containers store over again) to buy it back on the undo axis, via structural-sharing undo. The only budget-busting cliffs (clone time proportional to node count, and a multi-GB undo-stack heap) both sat on the undo axis, and clone-on-write keyed by child ids eliminates both, while the amplification is linear and bounded at realistic sizes. Deriving container raw instead would fix the cheap problem and leave the expensive one.

The standing evidence is the combined depth-x-size axis in `container-raw.bench.ts`, and its prose twin. A _full_ re-materialization is what every structural edit pays. A quote or list item checks each line against its own previous bytes, so the cost is per line as much as per byte:

- **Prose-length lines** (the deep prose rows): under a tenth of a µs per line, which comes to about 1.3 µs per KB.
- **One long line per level** (the deep-nested rows): around 0.15 µs per KB, since there are hardly any lines to check.

Both kinds of row rebuild a chain nothing changed in, and the unchanged lines above and below an edit go through as one slice of the old bytes. An edit's own lines get written line by line on top of that, which in my runs made a prose chain with one typed line about a third slower than the untouched one. So realistic deep nesting stays in the floor class (microseconds to a few ms), and the superlinear tail is confined to adversarial shapes (under 2 ms at depth 16 × 100 KB). Depth isn't the variable; the bytes and the lines each enclosing container holds are. The rows are the `ancestryRebuild` section of `baseline.json`, report-only like every bench row, one epoch per re-bless.

**Keystroke-latency attribution.** The dominant steady-state keystroke cost is framework reactive-flush work proportional to the number of _mounted_ components. It sits outside every boundary where the editor's own code hands off to the next piece. Only the edited block re-renders, and parse, inline refresh, ancestry rebuild, and snapshot each run about one unit, yet the flush scales linearly with mounted block count. Which is the annoying part: no amount of tuning inside the editor's own code touches it. The only lever that turns O(mounted) into O(viewport) is to genuinely unmount off-screen blocks. Hence virtual rendering.
