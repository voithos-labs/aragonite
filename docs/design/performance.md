# Editor Performance

The tour:

1. [The one idea](#the-one-idea): why typing cost doesn't grow with document size, and the exceptions this doc refuses to hide.
2. [Scale claims](#scale-claims): what a keystroke and a load cost, qualitatively.
3. [The four axes windowing does not bound](#the-four-axes-windowing-does-not-bound): the exceptions, current numbers first.
4. [Costs beside the keystroke rows](#costs-beside-the-keystroke-rows): toolbar reads, kind re-derivation, and one retracted axis.
5. [The numbers and the gate](#the-numbers-and-the-gate): where the exact numbers live, the three commands, what's gated versus report-only, and why a red run on your machine is expected.
6. [Two architectural decisions](#two-architectural-decisions): why containers store their full source, and why windowing is the only lever that matters.

## The one idea

**The editor only mounts what you can see.** A 10MB document and a 10KB document have the same number of live components on screen, so typing costs the same in both. That's virtual rendering (`docs/design/virtual-rendering.md`), and nearly every performance property below is downstream of it.

There are exceptions, and windowing reaches none of them: loading a document, editing inside one enormous block, and any derivation that walks the CST rather than the mounted set. Every one is called out here on purpose. A performance doc that lists only its wins is advertising.

## Scale claims

Qualitative shape here; the exact numbers live in `src/lib/test/perf/baseline.json`, and [The numbers and the gate](#the-numbers-and-the-gate) says which of them are enforced.

- **A keystroke is O(viewport).** Single-digit milliseconds on realistic documents, and it stays bounded into the 10MB range because windowing caps the mounted component set at what's on screen. The four axes in the next section are the exceptions, and they're exceptions because they read something other than the mounted set.
- **Load is O(document size).** The reactive tree is materialized up front (`$state`-proxying every node, assigning ids, seeding heights), which is script-bound and linear in node count. Sub-second at realistic sizes, multi-second only at the hundreds-of-thousands-of-blocks extreme. Windowing bounds the mount at load, not this materialization. The only lever is lazy or shallow proxying of the node tree, an architectural change deferred until a workload needs it.

## The four axes windowing does not bound

Four keystroke axes read something other than the mounted set. Their statuses differ: the first is recorded as a reference rather than gated, the second is gated at its own baseline, the third and fourth are measured and reported rather than gated. (The `#N` references below are issues in the defect ledger.)

### 1. Editing one long paragraph

A single block's span rebuild scales with paragraph length, because windowing windows blocks, not the interior of one block. It's transient: any Enter splits the paragraph into viewport-bounded blocks, so it only surfaces from pasting a multi-MB blob into one block. The lever, if a real workload ever needs it, is intra-block DOM reconciliation of the rebuilt span run. The inline scan itself holds linear across this axis, emphasis-dense shapes included, so the rebuild is the whole term.

### 2. Typing inside a large container

A container's `raw` (its verbatim source bytes, children included) holds its full outer source, so every keystroke inside the container has to keep that copy honest. The rebuild now rewrites the changed child's region alone (§ 9 of `editor.md`), reading one child instead of all of them. Blessed 2026-08-26 on the production build (a bless records a measured number as the accepted baseline): **3.3 ms** per keystroke for a 1MB single giant list and **3.0 ms** for a giant blockquote, **5.4 ms** for the 10MB list, against **17.7 / 16.0 ms** before the fix. The `giant-single-{list,blockquote}-interior` rows type inside the container and gate it.

<details>
<summary>The history of this axis, for the curious</summary>

- The variable is the container's CHILD COUNT, not its bytes and not where the caret sits: CPU-profiled on 2026-08-26, a keystroke on the head child and one twenty children deep cost the same, and the dominant term was the `$state` proxy's read trap (about 25,000 of them per keystroke on a 1MB list), not the concatenation those reads fed.
- Production build at 1MB, before the fix: 17.7 ms per keystroke for a single giant list, 16.0 ms for a giant blockquote, against ~2.6 ms, the recorded DEV-build baseline, for the same fixtures typed into a paragraph ahead of the container. The control had no production reading of its own until the re-bless, so read the gap as a shape rather than a ratio.
- The **~52 ms** this doc carried until then was a dev-build number: roughly 30 ms of Svelte's dev-only subtree relabelling over roughly 21 ms of editor work, a cost the gate and the README charts paid and no user ever did.
- The axis belongs to the container `raw` contract rather than to any one feature: it measured the same with the container kind re-derivation disabled.
- It went unrecorded until 2026-07-28 for an embarrassing reason: every latency row prepended a paragraph, so the caret always had a top-level home and never sat where the cost was.
- What remains on this axis is the tail join, the fourth axis below.

</details>

### 3. A live whole-document derivation

A reader keyed on the editor's **content version** (the counter that ticks whenever the document's bytes change) walks the CST, not the mounted set, so windowing can't bound it. The bundled footnote reference is the only reader today, and it's the reader that pays: with no `[^label]` widget mounted the cost is zero. O(document shape) rather than O(viewport), and far cheaper than what it replaced (each mounted widget used to inline-parse the whole document itself, 10-140× worse). Measured, not gated.

**Browser-measured 2026-08-14** by the `rung-bracket-dense-footnotes` report rows, typing into a bracket-dense document with reference widgets in the viewport: **4.1 ms** p50 per keystroke at 100KB and **11.7 ms** at 1MB, against **2.7 ms** at both sizes for the identical bytes on the rung-free route. The mounted widget count is 20 at both sizes, since windowing bounds the mount, so the growth is the document, not the readers. Those rows were measured while the version was still derived by touching every node (the walk #185 removed, node-measured at ~1.8 ms at 100KB and ~18 ms at 1MB), so they're a ceiling for the shipped route rather than a reading of it.

How the cost got this small, for the curious:

- The version is announced at each byte-writing entry rather than derived from a touch walk over every node, which removed the axis's dominant term (#185) for an O(1) counter. The trade: a commit moving no byte still invalidates, where the walk compared fields.
- The reader's own walk memoizes each top-level subtree's references against the bytes they came from, and the serializer never recursing (`editor.md` § 12) is what makes a subtree's `raw` a sound witness for everything under it. So a keystroke re-parses the edited subtree and re-reads two fields per sibling (`raw`, `kind`): O(top-level count + edited subtree) instead of an inline parse per prose leaf.

### 4. The lower join at a large container's tail

After a write in a container's last child, with a block following the container, the editor asks whether the container and that follower now re-read as fewer blocks (a list standing above indented code absorbs it, say), because that's what a reload would do with the bytes. The ask parses the window, the container's own bytes included: **~34-37 ms** per keystroke at ~650KB, against ~0.5 ms with the ask off. Not gated, tracked as #182.

It's the interior-typing axis's twin at the other end, and a different cost: the ask parses bytes where the rebuild read children, so the child spans do nothing for it. The gated fixtures are single top-level blocks, so no ceiling sees it.

## Costs beside the keystroke rows

Three more costs are measured without being keystroke axes, and one axis was retracted.

**The toolbar's cross-block pressed-state read** walks the selected range rather than the mounted set. It's memoised per (selection, content version) and answers every registered mark from one decomposition, so a four-button toolbar pays one pass per selection change instead of four. Node-measured 2026-08-25 over a document of 76-byte paragraphs each wholly covered by `strong`, four ids per read: **10.9 → 3.6 ms** at 500 blocks and **42.7 → 12.7 ms** at 2000. The decomposition dominates, not the parses, so the memo is where the win is. (The read was driven through `makeKeydownEnv`, the cross-block test harness, so the endpoints came off `SelectionState` the way production reads them; a harness that hands the read plain endpoint literals instead moves the absolutes several-fold, which is why the method is named.) A shift-drag still pays it per event, every event being a new selection. Not gated.

**The single-block half of that read** is memoised too, on the block's own bytes and the selection rather than a composed key, since the display there is the block's whole raw. A `selectionChange` fires on every keystroke, so a four-button toolbar over a large paragraph costs one coverage parse of that block instead of four, O(block) either way. No ceiling of its own; it rides the gated typing rows wherever a toolbar is mounted.

**The container kind re-derivation** parses the container's whole raw when its opener line's verdict moves (a typed `> [!TIP]` turning a blockquote into a GitHub alert). That's one parse per kind transition (~53 ms on a 1MB blockquote, against ~5 ms for the neighbouring keystrokes), and it's the feature doing its work, not an axis. Ordinary typing on an opener line never reaches it, because the gate compares what the line opens as, not whether it changed.

**And the retraction.** A flat high-block-count keystroke cost was once recorded here as an O(top-level-count) axis. It wasn't one. Measurement showed a harness artifact, not editor work: the latency harness summed the whole `$state`-proxy children array on every settle poll. Flat-document keystrokes are O(viewport) like every other shape, unless a whole-document derivation is live (the third axis above).

## The numbers and the gate

`src/lib/test/perf/baseline.json` holds the exact numbers and the machine spec, and when this doc and that file disagree, the file is right. The README's performance charts are generated from that baseline by `scripts/render-perf-chart.mjs`, so a re-bless and a chart regeneration are one act and the pictures can't drift from the gate.

Three commands measure the editor over shared deterministic fixtures, and exactly one of them is a gate. Work out which one you're looking at before you panic about a number.

| Command               | Layer          | What it does                                                                                                               |
| --------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `npm run perf:editor` | bench (Vitest) | parse / clone / ancestry-rebuild / snapshot-push timings, written to `perf-results/`                                       |
| `npm run perf:e2e`    | browser        | fixture load wall-time plus per-keystroke p50/p95 through real Chromium; report only                                       |
| `npm run perf:check`  | **the gate**   | builds the app, previews it, and gates keystroke p50 against `baseline.json` on that production build; fails on regression |

The browser and gate scripts arm their own env switches (`PERF` / `PERF_GATE`). Outside them, in the full `npm test` suite for instance, the `e2e-perf` specs self-skip in seconds.

### What is gated, what is report-only

One table, replacing the two this doc used to carry:

| Rows                                                     | Status          | Enforced by                                                                                                                                                                                                                                                  |
| -------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `e2e` keystroke p50 (the `GATED_ROWS` set)               | **Gated**       | `npm run perf:check`, over a production build; deliberate, not in `npm test`. Ceiling = baseline × 1.1 + 5 ms, × `PERF_RUNNER_SCALE` (1 locally, the tight gate; CI sets 2.5)                                                                                |
| `counters` (structural amplification, clone byte parity) | **Gated**       | Hard ceilings in `counters.test.ts`, inside the commit gate (`test:editor:perf`, which `npm test` runs); `amplification.test.ts` is its report-only sibling that logs the factors. Clone byte parity: a clone serializes to exactly its source's byte length |
| `parse`, `snapshot*`, `ancestryRebuild`                  | **Report-only** | Nothing; dev references, environment-sensitive, read them as orders of magnitude, not targets (see baseline.json's own note)                                                                                                                                 |
| p95, and the `single-giant-paragraph` rows               | **Report-only** | Nothing; p95 catches single GC-pause keystrokes and is noisy, and the giant paragraph is the first axis above                                                                                                                                                |
| `rung-*` (installed inline rungs)                        | **Report-only** | Nothing; printed by `npm run perf:e2e`, skipped by the gate (why: below)                                                                                                                                                                                     |

A gated row and the ceiling the formula gives it, from the 2026-08-26 bless:

```ts
// baseline.json, e2e section
"flat-prose-1MB": { "loadMs": 72.3, "keystrokeP50Ms": 2.7, "keystrokeP95Ms": 6.4 }
// the gate's ceiling for that row's p50
(2.7 * 1.1 + 5) * PERF_RUNNER_SCALE; // 7.97 ms locally; 19.925 ms on CI, where the scale is 2.5
```

And the two counter ceilings, executed on the same fixtures `counters.test.ts` uses:

```ts
const nested = parse(generateFixture('nested-containers', 100_000));
containerRawBytes(nested.children) / docByteLength(nested); // 3.55; the ceiling is 3.9
const tables = parse(generateFixture('table-heavy', 100_000));
containerRawBytes(tables.children) / docByteLength(tables); // 1.96; the ceiling is 2.2
```

The gated keystroke set, precisely (16 rows): flat-prose, nested-containers, reference-heavy, table-heavy and many-small-blocks at 1MB; flat-prose, many-small-blocks, reference-heavy and the three giant-single containers at 10MB; the container-interior rows (list and blockquote at 1MB, list at 10MB); and two live-mode 1MB rows (flat-prose, nested-containers) ceilinged at their source twins. `single-giant-paragraph` is the one shape gated nowhere, being the axis. Ceiling and baseline bumps are deliberate decisions with a changelog note, never a reflexive edit to make a red run go away.

### Environment scaling, and the red you will see

Ceilings derive from baselines measured on the calibration machine (the pinned dev machine `baseline.json` names). A slower environment scales the whole ceiling via `PERF_RUNNER_SCALE` instead of re-blessing baselines per host. Local runs stay unscaled, which is the tight gate. CI sets the scale in the workflow from its measured slowdown, which makes the CI perf job a gross-regression net rather than a precision instrument. Both run the same command.

**On any host that isn't the calibration machine, an unscaled `perf:check` reads red by design.** Measured 2.2-3.4x on pure JS on a laptop, and no single scale factor tracks that spread across rows. So when yours reads red, that's not you breaking the editor. Treat a non-pinned-host run as diagnostic, not as a regression signal.

### What `perf:check` actually gates

The dev machine is the pinned hardware, and same-machine run-to-run p50 spread is a few percent, so an absolute baseline plus tolerance catches regressions without a CI runner. It measures a production build, which is what makes the numbers the editor's rather than Vite's. A dev-server run measures Vite's transform overhead and Svelte's dev-only bookkeeping alongside the editor, and the container rows are how far apart those two readings can be. Re-bless the baseline after a Chromium/OS/toolchain bump moves the floor.

It gates **steady-state** p50, which means it's blind to a one-slow-keystroke regression: a single slow first-edit full re-render barely moves a 30-sample median. That class is guarded separately, by `block-render-scoping` inside the fast `npm test` gate, an e2e spec that reads the perf instruments to count how many blocks an edit re-rendered and fails when the count fans out.

### Why the rung rows report rather than gate

A rung is one level in the inline parser's ordered ladder of recognizers; a plugin installs its recognizer at one, and the `rung-*` rows are what typing costs with one installed. Every standing ceiling measures an EMPTY inline registry, because the editor route installs no plugins, so nothing saw what a registered rung costs until these rows landed. They stay ungated for two reasons, and both are about what a ceiling would mean rather than about runtime:

1. The cost belongs to whichever plugin registered the trigger. A recognizer is the plugin's code, so a ceiling here would pin a number the editor doesn't own and would move under a plugin's own release.
2. No clean control exists. Each row measures its fixture twice, on `/test/plugins` where the rung is installed and on the rung-free editor route, but the plugins route also installs eight base plugins (two of them whole-document derivers), so the delta bounds a rung's cost from ABOVE and isn't attributable to the rung alone. A route delta is evidence about a mechanism's shape, never a per-rung constant. Building a rung-only route to get a clean control was rejected as out of proportion to a report row.

Each row records its mounted-widget count, so a row whose plugin silently stopped installing fails rather than reporting the control number as the rung's. A baseline change here is a decision to make deliberately, from the numbers, not a diff to bless.

### Fixtures

`src/lib/test/perf/fixtures/generate.ts` builds nine seeded shapes at any byte target: flat-prose, nested-containers, many-small-blocks, single-giant-paragraph, reference-heavy, table-heavy, giant-single-list, giant-single-blockquote, giant-single-table. The same (shape, size, seed) always yields identical bytes, golden-pinned, so numbers stay comparable across runs and machines.

```ts
generateFixture('flat-prose', 1_000_000).slice(0, 40);
// '## juliet hotel november kilo\n\ncharlie in'   (NATO-alphabet prose, about a megabyte of it)
```

### Instruments

`src/lib/perf/instruments.ts` holds the dev-mode counters: snapshot clone bytes, rebuild-depth histogram, parse timing, inline-refresh node counts, and an undo live-byte gauge. Recording is off until enabled, and the switch only arms under dev/Vitest, so production pays one boolean check per record site. On `/test/editor` the test bridge exposes them as `__test.perf.enable()` / `.reset()` / `.snapshot()`, callable from DevTools or `page.evaluate`.

The shape a snapshot comes back in, from a node-side probe that parsed one 10KB fixture and computed one block's inline tree (the browser bridge hands you the same object, with the render, mount, and keystroke fields filled in):

```ts
perfSnapshot();
// {
//   parseCount: 1, parseMsTotal: 0.3, parseBlockCount: 57, inlineComputeCount: 1,
//   snapshotCount: 0, snapshotCloneBytes: 0, rebuildDepths: {}, containerKindReparses: 0,
//   formatCoverageReads: 0, undoLiveBytes: 0, undoEntryCount: 0,
//   blockRenderCount: 0, blockRenderMsTotal: 0, blockRenderPaths: [], keystrokeInPageMs: [],
//   mountedBlockCount: 0, decorationRuns: 0, islandRebuilds: 0, islandKeyScans: 0
// }
```

The undo gauge is push-sampled: it updates only when a snapshot is pushed, and undo, redo, and clear don't refresh it. Read it as "live bytes as of the last push", not a live value.

### One caveat on every non-gate number

The bench and browser layers run under DEV (Vitest / dev server) with invariant assertions active, so every timing they print is a conservative upper bound on production, not a production latency. The real thing is faster than what you're reading, never slower. The gate is the exception: `perf:check` measures the production build.

## Two architectural decisions

**Container raw materialization.** Container nodes keep their full materialized outer source text. That spends memory on the amplification axis (the bytes containers store over again) to buy it back on the undo axis, via structural-sharing undo. The only budget-busting cliffs (clone time proportional to node count, and a multi-GB undo-stack heap) both sat on the undo axis, and clone-on-write keyed by child ids eliminates both, while the amplification is linear and bounded at realistic sizes. Deriving container raw instead would fix the cheap problem and leave the expensive one.

The standing evidence is the combined depth-x-size axis in `container-raw.bench.ts`: a FULL re-materialization, which every structural edit pays and which a keystroke paid before the child spans, costs ≈2 µs per KB, near-constant across the axis, so realistic deep nesting stays in the floor class (microseconds) and the superlinear tail is confined to adversarial shapes (tens of milliseconds at depth 16 × 100 KB). Depth isn't the variable; the bytes each enclosing container holds are. The rows are the `ancestryRebuild` section of `baseline.json`, report-only like every bench row, one epoch per re-bless.

**Keystroke-latency attribution.** The dominant steady-state keystroke cost is framework reactive-flush work proportional to the number of MOUNTED components. It sits outside every editor seam (a seam: a boundary where responsibility passes from one piece of code to another). Only the edited block re-renders, and parse, inline refresh, ancestry rebuild, and snapshot each run about one unit, yet the flush scales linearly with mounted block count. Which is the annoying part: no amount of tuning inside the seams touches it. The only lever that turns O(mounted) into O(viewport) is to genuinely unmount off-screen blocks. Hence virtual rendering.
