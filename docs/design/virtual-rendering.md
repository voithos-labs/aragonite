# Virtual (Windowing) Rendering — Design Spec

## Goal

Bound the number of mounted block components to the viewport, so two costs stop scaling with document size:

- **Per-keystroke cost.** The dominant steady-state cost is framework reactive-flush work proportional to the number of mounted components (see `docs/design/performance.md`). The only lever that turns O(mounted) into O(viewport) is to genuinely unmount off-screen blocks.
- **Initial render.** Large documents in several shapes (many small blocks, deep nesting, large tables) cannot materialize their DOM at all when every block mounts.

`content-visibility` is not a substitute: it skips paint and layout but leaves components mounted, so their per-keystroke reactive work still runs. The cost being targeted is script, not layout — windowing must be real JS unmounting, not a CSS hint.

## Windowing Model

Windowing is a property of the single rendering primitive the editor reuses at every nesting level. Each rendering **scope** (the editor root, and every container that holds a child list) windows its own children:

- The children are rendered as a contiguous **slice** `[start, end)` plus a top and bottom **spacer** sized from the height model. The spacers are siblings of the rendered slice, never entries in it. Their heights sum to the off-screen totals, so the scroll container's native `scrollHeight` equals the full modeled document height — the native scrollbar, the scroll range, autoscroll bounds, and reveal all share one real coordinate space. No faked scroll, no transforms.
- A scope **self-activates**: it windows only when its estimated content height exceeds a viewport budget. Small containers never activate and render exactly as a non-windowed editor would. Activation uses **hysteresis** — separate activate and deactivate watermarks — so a list hovering at the budget does not thrash between windowed and plain on every edit. The budget is the **only** gate: who owns the scroll changes which scrollport is read, never whether a scope windows.
- There is one **scrollport** per editor, and every scope maps its position into its own pixel range. The scrollport is an abstraction over what actually scrolls — rect, offset, a writer, a change signal, and content width — resolved from the scroll mode: the editor root under `scrollMode='self'`, and under `'host'` the nearest user-scrollable ancestor (or the page viewport), the same resolution the autoscroll seam owns. One windowing implementation reads that port; the mode picks its target and nothing downstream branches on it.

```
scroll    → scrollport position → height model maps to [start, end) per active scope
          → slice mounts/unmounts → newly-mounted blocks measured in one batched pass
          → measured heights replace estimates → spacers reconcile + scroll anchor-corrects
keystroke → CST commit (unchanged) → only ~viewport-mounted blocks flush → O(viewport)
```

### The absolute-index contract

A non-windowed editor renders `children` with a keyed loop whose loop index **is** the absolute child index, and the whole editor keys off it: a block's path is its ancestor path plus that index, every structural operation targets a block by that index, and focus resolves through it. A sliced render makes the local loop index no longer equal the absolute index.

The load-bearing contract: **the index handed to a block and to every operation is always `windowStart + localIndex`, and the slice key remains the stable block id at the absolute index.** Leaking the local loop index silently operates on the wrong block and corrupts paths and structural operations — invisible until something deep breaks. This is the single most dangerous detail in the feature, and the slice computation is single-sourced so both flat and container scopes share it.

## Height Oracle and Model

A per-kind **height oracle** estimates and caches block heights. The durable commitment is the interface — an O(1) estimate plus a measured-height cache — not any particular estimator.

**Both the windowing wiring and the height model are extensible.** A plugin container inherits windowing by naming only its real variation (see § Recursive Windowing). For height, a kind may supply an optional per-kind `estimateHeight(node, { width })` descriptor field — an O(1) estimate with no subtree walk. The oracle consults it after the collapse probe and before the built-in switch, so a collapsed container still estimates at one chrome row (collapse wins) and the measured cache still supersedes both (a mounted block's real height is authoritative). A kind that supplies no estimate falls into the built-in switch's prose char-wrap default and self-corrects on first measure. The collapse probe on the reserved-chrome declaration is the other declarative influence: a collapsed container mounts only its chrome row.

- **Estimate — O(1), no subtree walk.** A per-kind heuristic: prose from `raw` character length and content width; a container from the larger of one line-plus-chrome per child or the blob-wrap of its materialized `raw` (all descendant text), staying O(1) via `children.length` rather than a recursive walk even though container raw holds the whole subtree (the container-raw decision, `docs/design/performance.md`); an image-bearing block from its image count and `|WxH` size hints, floored where a height isn't given in source. First layout is O(n) cheap reads, not O(n) tree walks.
- **Measured cache, keyed by stable id.** Once a block mounts, its real height is measured and cached by stable block id — not by index — so split/merge index shifts and undo (which restores ids with the snapshot) do not invalidate it. Measured always supersedes estimate; stale entries self-correct on the next mount.
- **Cumulative model.** Each activated scope owns a binary-indexed (Fenwick) tree over its children: index → pixel offset, offset → index, and total, all logarithmic. It is instantiated lazily on activation and maintained by the same structural-change flow that already syncs ids and refs, so there is no second bypass surface to keep in sync.

### Batched measure pass

Measurement is a **scope-owned batched pass**, not a per-block side effect. A fast scroll mounts many blocks in one frame; reading each block's geometry interleaved with reactive writes forces synchronous layout thrash — a regression inside a performance feature. Newly-mounted blocks enrol with their scope; a single pass then **reads all** their geometry and only afterward **writes all** the model updates. Never read-after-write in a loop. A narrow per-block path re-measures a single edited block through the same writer.

## Scroll Anchor Correction

When blocks above the viewport measure in (or the model otherwise mutates above the visible content), their slots grow or shrink while the top spacer is unchanged, sliding the visible content under the user — the feature's central UX risk.

Each scope corrects this itself. Before a height mutation it records the offset of the block at the top of its viewport; after, it re-reads that offset and shifts the scroll position by the delta, so visible content never jumps. The delta is read from the **cumulative model** (non-reactive, reflects the writes synchronously), not from live DOM geometry — a DOM read would see pre-flush layout and silently no-op. Reading no DOM also preserves the batched pass's read-all-then-write split: one scroll write after all model writes.

Native browser scroll anchoring and the manual correction cannot coexist: both rewrite the scroll position, double-correcting, and native anchoring is unreliable for windowed content anyway (its anchor node can be the very block unmounting as the slice shifts, or a spacer whose height is being rewritten). So exactly one of them runs, and **activation decides which**. In `self` mode the editor owns its scrollport and turns native anchoring off outright (`overflow-anchor: none`). In `host` mode the scroller belongs to the embedder: while a scope is windowing the editor withdraws its own subtree from the host's anchor candidates and corrects by hand; below the budget it corrects nothing and stays a candidate, so the host's native anchoring holds the reader. The manual correction is gated on the same fact, so the two can never both write one scroll position.

The residual of the host-mode opt-out: withdrawing the editor's subtree leaves the host nothing to anchor on whenever the viewport holds only editor content, so late-sizing content in the **host's own** chrome above the editor goes uncompensated while windowing runs. The host's scroller is otherwise untouched.

Because native anchoring is off, content that grows _after_ it was first measured — a remote image decoding in, a web font swapping, a lazy embed — would slide the viewport the same way. Each rendered block reports post-mount size changes; a change is gated against the height already recorded for that block (the common no-op resize costs nothing) and genuine growth is re-measured through the same scope-local anchor correction.

**Chrome above the list.** Chrome may sit above the block list either inside the editor (a header slot) or, in host mode, further out in the embedder's page. The slice math needs no case for either: a scope measures its list's live offset within the **scrollport's** content and takes its viewport as the list's intersection with the scrollport, so chrome shrinks or displaces the scope's window without any special handling. That offset is where the mode's arithmetic actually lands — an editor embedded partway down a page-scrolled shell has both a nonzero scroll and page chrome above it, and the two cancel independently. What the editor's own header slot does need is the correction, because its height is outside the height model: a slot that grows or shrinks routes its delta through the same scroll compensation a measured-in block does, under the same gate.

The residual artifact of estimate error is scrollbar-thumb drift — cosmetic, content-stable (anchor correction holds the viewport; only the thumb-to-content mapping is off), and shrinking monotonically as heights are measured. Its magnitude is bounded by the worst per-kind estimate error; the irreducible cases are blocks whose height is not a function of `raw` — an unsized image before decode, a heavily-wrapping table.

**The residual limitation:** a rendered block whose height is genuinely unpredictable from its source — a Mermaid diagram, a KaTeX render — has no exact estimate available before it mounts. A kind that renders at a stable skeleton size closes this by declaring `estimateHeight` (see § Height Oracle and Model): Mermaid estimates its diagram at the skeleton's fixed height, so the pre-measure estimate carries zero scroll-time error while the skeleton shows. A kind that cannot predict its rendered height omits the field and falls into the prose char-wrap default, estimated as if its source were prose; it reconciles through the ResizeObserver + anchor-correction path on first render and self-heals thereafter via the measured cache, so the viewport stays content-stable — but its pre-measure estimate is a guess, and the thumb drift before it first mounts is correspondingly larger.

## Resize and Width Invalidation

Narrowing the content column re-wraps prose, so cached heights computed at the old width are stale. On a width change the scope clears the measured cache, falls back to width-parameterized estimates, re-measures currently-mounted blocks immediately, and rebuilds the model — all inside an anchor correction so the viewport holds through the reflow. Height-only resizes are ignored (prose re-wraps on width, not height).

**Type scale is the same invalidation, on a different axis.** The estimate constants are calibrated at one font size, and the editor's type scale is font-relative, so a host that scales the text (`--editor-font-size`, or anything else moving the root's computed font size) moves every line box and the characters that fit on a line. Left unscaled, the error is systematic rather than per-block noise, and it reaches the activation decision: a document whose rendered height clears the watermark could be estimated under it and never window. So the estimates are read against the root's live computed font size, and a change runs the width path — drop the measured cache, rebuild, re-measure. A font-size change resizes no other box in the root, so it is observed on a one-`em` probe rather than the root's own resize.

## Recursive Windowing

Windowing composes through nesting because every scope windows its own children against the one scrollport:

- A small container never activates and renders exactly as before.
- A giant activated container windows its own children; its height is its model total plus chrome, and its parent's model reads that total as the child's single entry — **composition by parent-entry = child-total**, not a re-walk.
- Measured heights propagate upward through the stacked models by two passive, index-keyed channels: a directly-measured leaf updates its own scope's slot; a child container's measured box subtotal updates only the parent's slot for that child. So ancestor spacers stay correct without any scope re-walking its descendants.

The headline case is a long flat list: the list renders through its own child loop, bypassing the generic block-list primitive, so a checklist or bibliography of thousands of items windows directly rather than mounting the whole subtree. The per-container windowing wiring is single-sourced in one hook, so a future or plugin-registered container kind inherits windowing by naming only its real variation (its DOM selectors, its children source, whether it shadows the leaf channel).

## Reveal Before Act

Any operation that must touch a block's DOM — focus landing, caret placement, undo/redo restore, cross-block selection — first **reveals** the target. A reveal primitive descends each path level: if the target's ref is present (in window, overscan, or pinned), it recurses immediately; otherwise it computes the target's absolute offset from the height model, scrolls it into the window, awaits its mount, and recurses. The mount is awaited as a promise the mount effect resolves — event-driven, not a timer — so the fast path (every adjacent operation, all levels mounted) resolves within one tick with no scroll.

The wait is **bounded and degrades gracefully**: if the recomputed window provably excludes the target, the reveal returns rather than waiting for a mount that can never fire, and the caller operates on path state, skipping the DOM placement. Because CST and selection are path-based data, an operation whose target unmounts mid-flight still completes on state; reveal is invoked only for the DOM-touching tail.

A reveal that must also _hold_ what it revealed — a navigation, a search jump, a consumer restore — claims the **reveal anchor**. While a claim is live the root scope re-asserts the target's position on every measure pass **it runs**, instead of holding the top-of-viewport block, which is what keeps a target past undecoded images from being clamped off-screen as they collapse the document. Its reach is exactly that scope's own correction: growth reported upward from a nested scope is deliberately correction-free (the cross-scope residual below), so layout churn _inside_ a container never re-asserts the pin. The slot holds one target at its full path, with per-call ownership: a claimant may release only the pin it still holds, a superseded reveal stops refining rather than fighting the newer one, and any user-intent gesture in the document releases the pin — without ending the reveal's own settle, since a reader taking over is not a rival claimant. Nested scopes never claim the slot; their corrections would fight over one scroll position.

The mounted set of each activated scope is its slice, plus an **overscan** band, plus the **pinned** focused or caret block. The pin keeps the focused block mounted even when scrolled past the slice — extending the window to include it (bounded by a cap) so it renders in document order and the browser preserves its DOM node, and with it native focus and any in-flight IME composition. Beyond the cap — a caret parked thousands of blocks away before a far scroll — the pin is dropped and focus blurs; rare and acceptable. Refs become **sparse**: only mounted indices hold a ref, and consumers already null-check.

## Selection Under Windowing

Selection state is window-independent — endpoints are `(path, offset)` data — so copy, cut, and delete walk the CST by path and never the DOM. Select-all-then-copy on a huge document reads the whole CST with only a slice rendered.

The overlay degrades to visible-only for free: a selection overlay mounts per block, so only windowed blocks have an overlay, each classifying itself as start / middle / end / outside by path comparison. A selected block paints on mount and stops on unmount, so a large selection's highlight flows with the viewport. The active (caret-side) endpoint is always mounted via the pin and autoscroll, so its partial-rect measurement is always answerable; the anchor endpoint may be off-screen and is simply unpainted — correct, because it is off-screen. The accessibility announcement is built from selection state by a pure function, independent of what is mounted, so there is no regression.

## Table-Row Windowing

A giant table windows its rows the same way, self-activating behind the same height watermark (normal tables render unchanged). A table bypasses the generic block-list primitive exactly as the long-flat-list case does, so it reuses the shared windowing and slice wiring wholesale. The one new mechanic is geometry: a table is a CSS grid and a row carries no layout box of its own, so a row's height is read from a cell (a cell stretches to the grid row track) and the spacers span the full grid width. Reveal and path-descent reach row then cell, so an off-window cell can be a selection endpoint and a collapsed selection lands the caret in the correct cell.

## The Mounted-Set Bound

The load-bearing gate is a **mounted-block count**, not a render count or a timing. A component count is build-independent (identical in dev and prod, unlike timing), so the ceiling — mounted blocks bounded by viewport plus overscan plus pins, independent of document size — is a hard, machine-independent assertion in the commit gate. Render-count instruments still prove windowing did not regress render scoping, but the mounted-set bound is the primary proof that O(mounted) became O(viewport).

## Known Limitations

- **Cross-scope anchor residual.** Anchor correction is scope-local: it fixes the scroll position only for height mutations within its own scope. The channel a nested scope uses to push its re-measured subtotal into its parent is deliberately uncorrected (so a deep leaf measure does not cascade scroll fixes up the chain). So when a nested container above the viewport grows after the viewport has settled, the parent's top spacer grows with no compensating shift — the same content-jump, one scope up. Minor and graceful: it surfaces only when an off-screen nested container measures in after the viewport settles (the common case measures the whole chain in one flush before paint), and its magnitude is bounded by the now-per-scope width estimate.

## VR Identifier Catalog

Windowing hazards carry `VR-N` tags the way invariants carry G-numbers, cited from source comments, tests, and e2e requirement files. This table is the catalog those citations resolve against; it is derived from the sites that use them, so an identifier absent here is one nothing currently cites.

| ID    | What it names                                                                                                                                                                                                                                                          |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VR-1  | Width invalidation. A width change re-wraps prose, so measured heights are stale; the scope re-measures while holding the anchor.                                                                                                                                      |
| VR-2  | Scroll-anchor correction. A jump into an unmeasured band swaps estimates for real heights mid-flush; the correction compensates so the viewport does not slide. Native `overflow-anchor` is off wherever this runs, and only there.                                    |
| VR-3  | Per-scope width. A nested scope estimates at its own content width, never the scrollport's.                                                                                                                                                                            |
| VR-4  | Measure batching. A scope reads every mounted height before writing any, so a fling costs one reflow per frame instead of one per block (and one per table row).                                                                                                       |
| VR-5  | Mount-wait termination. A reveal whose target can never mount (a collapsed body, a scroll that missed) degrades instead of awaiting forever; the wait is woken only by a same-index mount.                                                                             |
| VR-6  | Off-window answers. Predicates that gate traversal read the CST, not the sparse ref array, so a windowed document answers identically to an unwindowed one.                                                                                                            |
| VR-8  | Spacer skeleton. A compositor fling can outrun mounting, so spacers paint a placeholder tint rather than blank; overscan widens the band.                                                                                                                              |
| VR-9  | Height-model robustness. Out-of-range writes and reads must not poison the Fenwick tree.                                                                                                                                                                               |
| VR-11 | Viewport intersection. A scope occupies only its intersection with the scrollport's viewport, so scopes tiling it sum to roughly one viewport's mounted set.                                                                                                           |
| VR-12 | Sync focus cannot reveal. The sync focus dispatchers do not mount an off-window head, so a landing farther than overscan silently no-ops the caret. A landing whose index scales with anything but caret distance — a paste's, with the clipboard — must reveal first. |
| VR-14 | Inverted window. A window whose end precedes its start (from a stale derive) collapses to empty rather than producing a negative slice.                                                                                                                                |
| VR-K1 | Row-windowed table geometry. Index 0 is the first _mounted_ row, not row 0, so column geometry must be read from whichever row is mounted.                                                                                                                             |
