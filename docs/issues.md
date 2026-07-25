# Known Issues

Log of known editor issues. Each entry carries severity, affected files, a description,
reproduction (where relevant), and either a **Target** version (if scheduled via the roadmap)
or a **Why deferred** rationale (if not). Remove entries when shipped.

## Core editing

### A ranged edit spanning a fence line corrupts the fence

**Severity:** important (byte corruption; the block absorbs the rest of the document on reload)
**Files:** `src/lib/components/blocks/code/CodeBlock.svelte` (`codeBackspace` / `codeDelete` bail on
a non-collapsed selection; `onBeforeInput` intercepts only `insertText` and `insertLineBreak`;
`cutTail` writes the spliced display text directly),
`src/lib/components/blocks/code/code-fence-boundary.ts` (`classifyFenceBoundary` takes one offset,
not a range)

The fence lines are structure, not content, and every gesture that rewrites whole lines is now
clamped to the body window. The gestures that rewrite a **range** are not. Select across a fence
line and press Backspace, Delete, or any printable key: the block's own guards decline on sight of a
selection, `onBeforeInput` does not claim the input type, so the native ranged edit lands in the
contenteditable and the surface commits whatever text remains. The committed block is an unclosed
fence, which absorbs every following block on the next parse. `cutTail` is the same family's
explicit-write member: it splices the display text itself with no clamp.

**Repro:** in a fenced code block, select from the last body line through the closer fence and press
Backspace; save and reload.

**Why deferred:** closing this needs a beforeinput-level ranged-edit guard covering delete, cut and
type-over together, not a clamp per gesture: the block-level guards run below the point where the
selection is still known to be a range. Fixing one member is 1-of-N and would additionally make cut
and copy disagree about what a fence-crossing selection means, which is its own decision.

### Interactive reading mode (live task checkboxes) — deferred product question

**Severity:** minor (product decision, not a defect)
**Files:** `src/lib/components/blocks/list/ListItemBlock.svelte` (`toggleTask` gate),
`src/lib/styles/editor.css` (reading-mode checkbox `pointer-events: none`),
`src/lib/plugins/details/DetailsBlock.svelte` (the same class: the disclosure toggle)

Reading mode v1 is fully inert: task checkboxes render but do not toggle, and the details
disclosure (which commits an `open` metadata edit) is likewise gated. A rendered document
(GitHub, Obsidian reading view) keeps some of these live — whether reading mode should allow
a curated set of interactive edits is a product question, not a gating bug.

**Why deferred:** the original anchor (the presentation-modes milestone's later rungs) shipped
in 0.9.26 with reading mode fully inert, so the decision is now a standing product question,
re-anchored to the 1.1 shell integration. Inert-at-freeze is also the safe ordering: ungating
a curated interaction set later is additive, while shipping interactivity now and re-gating it
after 1.0 would be a breaking change, and reading-mode inertness is lint-enforced (G4.19),
an invariant worth keeping whole until the shell decides which interactions survive.

### Enter-at-end can produce a live block pair that reparses as one paragraph

**Severity:** minor (live-tree vs reload divergence; byte round-trip unaffected)
**Files:** `src/lib/tree-operations/node-ops.ts` (`splitNode` — the second half is minted
with empty `leadingTrivia` and no blank-line separator), `src/lib/core/serializer.ts`
(composition: `prefix + Σ(leadingTrivia + raw) + suffix` faithfully emits the missing gap)

Enter at the end of a paragraph splits `Hello world\n` into a first block ending in a single
newline and an empty second block (`raw: '\n'`, `leadingTrivia: ''`) — while the second block
is empty its bare newline reads as the blank-line separator, but typing `x` into it rewrites
that raw to `x\n`, and the document now serializes to `Hello world\nx\n`. That is a
single-newline join: GFM lazy continuation reparses it as ONE two-line paragraph, so
split-then-save-then-reload merges what the live session showed as two blocks. Byte
round-trip (`serialize(parse(s)) === s`) holds throughout — the divergence is
`parse(serialize(liveTree))` disagreeing with the live tree's structure, which the round-trip
oracles cannot see.

**Fix direction:** the sibling list-exit path solved its instance of this class by minting a
uniform blank-line separator at the exit gesture. The splitNode instance cannot reuse that
shape as-is: the separator would have to be minted before the successor kind is known (Enter
precedes typing), and the successor kind decides whether one is needed — only a paragraph
lazy-merges, a heading/list/blockquote never does. A kind-dependent separator is impossible
because the simulation's `ExpectationTracker` is model-free (it predicts only char insertion
and resyncs on structural gestures), so the trivia cannot change mid-typing. A uniform mint at
split (blank before every successor) double-counts the deliberate `pressEnter`+`softEnter`
thematic-break cadence and broadens para→heading spacing. So this needs its own design pass
with gesture re-choreography, decided against the merge/undo paths that read those bytes.

**Why deferred:** byte round-trip holds and the live session is self-consistent; the
divergence needs a save→reload boundary to observe. Not reachable by the current simulation
notes (they type para→heading and list-exit→paragraph, not Enter-at-end-then-paragraph).

### Nested structural content commit seeds its undo snapshot differently from the top-level path

**Severity:** minor (undo-selection nuance; the edit is correct and byte-safe)
**Files:** `src/lib/editor-actions/nested/nested-block-edit.ts` (`updateBlockContent` structural arm),
`src/lib/editor-actions/block-edit.ts` (the top-level sibling)

A nested structural content commit pushes its own undo snapshot at `{ path: leafPath, offset:
preEditOffset }`, while the top-level sibling skips to the debounced typing snapshot
(`snapshot: 'skip'`). The two content-commit paths therefore seed the undo selection
differently, and the nested coordinate names a pre-edit offset on a node whose kind/shape the
commit may have just changed. No corruption results — the restored caret is a view concern — but
the post-change coordinate and the top-level divergence want a joint look.

**Why deferred:** post-edit-caret-versus-pre-edit-tree selection semantics touch the debounce
seam and both content-commit factories together — a careful reconciliation, not a spot change.
Fold into the history-seam pass (limestone internal integration).

### writeText clipboard writes normalize line endings per-OS; wry reliability unproven

**Severity:** watch (no defect today; relevant to the limestone/Tauri integration)
**Files:** `src/lib/editor-actions/container-block-component.ts` (the whole-block Mod+C/Mod+X write)

The focused-block copy writes via `navigator.clipboard.writeText` — no ClipboardEvent exists in
a keydown handler. Two platform behaviors to watch: Chromium's `writeText` normalizes a
multi-line payload to the OS line ending (CRLF on Windows — the mermaid e2e normalizes before
comparing; intra-editor paste re-normalizes to LF, so no corruption), and the cross-block
clipboard code documents wry (Tauri) refusing `writeText` in some contexts — unverified for this
path. A setData-in-a-copy-event fallback was proven workable during implementation (the native
copy event does fire on the focused div; `preventDefault` currently suppresses it), at the cost
of per-surface `oncopy` handlers.

**Fix direction:** if the limestone integration observes a failed focused-block copy under wry,
switch the tail to the proven copy-event fallback behind the same shared seam.

**Why deferred:** watch-class; needs the real embedder to falsify.

### The editable-surface grammar thread is optional and unsupplied, so join-paste always reparses with the global grammar

**Severity:** minor (latent parity hole; unobservable until per-instance enablement ships)
**Files:** `src/lib/components/blocks/editable-surface.ts` (`grammar?: GrammarView`),
`src/lib/selection/cross-block/dispatch.ts` (the required-nullable sibling)

`CrossBlockDispatchDeps.grammar` is required-nullable by design so a construction site
cannot silently skip the thread, but `EditableSurfaceDeps` re-widened it to optional and
none of the four production surfaces supplies it — the cross-block join-paste reparse
always uses the global grammar. Byte-identical today (instance grammar cannot diverge
until the enablement predicate gets a public prop), which is why nothing observes it.

**Fix direction:** either wire `registryView.grammar` at the four surfaces and make the
seam field required-nullable to match the dispatch tier, or delete the dead optional and
re-add it with the enablement API.

**Why deferred:** adjudicate with the enablement prop's design at the limestone
integration — the same decision decides which shape is right.

### Emphasis-dense giant paragraphs scan quadratically

**Severity:** watch (adversarial shape inside the documented-transient giant-paragraph axis)
**Files:** `src/lib/core/inline/scan/emphasis.ts` (`wrapMatch` — `nodes.indexOf` + splice)

Measured (2026-07-21 elegance run): `'*a*'.repeat(N)` scans at 0.86ms/8.2ms/94ms for
6KB/24KB/96KB single blocks — O(N^~2). Only reachable by pasting emphasis-dense
content into ONE block, i.e. inside the axis `docs/design/performance.md` already
documents as transient (any Enter splits it); at 24KB the cost still sits under the
10MB keystroke ceiling.

The 2026-07-21 entry called four sibling flood paths linear. Re-measured 2026-07-24,
two of the four were wrong: backticks (growth exponent 0.01) and entities (0.91) are
linear and stand; the autolink delimiter prune measured 2.00 and is now bounded (a
lookup over the sorted, disjoint matches); the directive closer lookup measured 1.95
and has its own entry below.

**The deferral envelope is understated, not wrong.** Every measurement above stops at
96 KB, where the cost is a stall. The 0.9.35 adversarial pass measured the same scan at
roughly 53 s on an 800 KB single block, which is one ordinary paste and a reload to
recover from. So the deferral stands on reachability (the shape needs emphasis-dense
content pasted into ONE block, and any Enter splits it), not on the cost being small.

**Why deferred:** the true fix is porting commonmark.js's linked delimiter list —
med-high conformance-fidelity risk against a faithful port, for a shape the perf model
already brackets. Re-open only if a real workload holds emphasis-dense multi-KB single
blocks.

### Directive closer lookup is O(openers × closers) when nothing closes the openers

**Severity:** watch (adversarial block shape; the residual of the closer-index fix, not a regression of it)
**Files:** `src/lib/core/directive/container-opener.ts` (`findDirectiveCloser` — binary
search to the first later closer, then a forward walk for one long enough)

Measured 2026-07-24: `':::a\n:\n'.repeat(N)` parses at 12.2ms / 126.8ms / 1889.9ms for
N = 2k / 8k / 32k, growth exponent 1.95. Read from the source the same day: the closer
index removed the per-opener scan over every line, but the lookup still walks the closer
list forward until it finds a colon run at least as long as the opener's. A document
whose closer-shaped lines are all shorter than its openers never finds one, so every
opener walks every closer.

**Fix direction:** index closer positions per colon count, so the lookup is a binary
search per candidate count instead of a walk — the shape the position index already uses.

**Why deferred:** the shape needs a document of unterminated long fences alongside
short colon-run lines, which no authoring workload produces; a real unclosed `:::a`
flood (the shape the index was built for) stays linear. Fold into the next scan-bounds
pass rather than editing the opener for it alone.

### Blank-line detection admits Unicode whitespace, where GFM means space and tab

**Severity:** minor (block structure diverges from GFM on a common paste artifact; byte round-trip
holds either way)
**Files:** `src/lib/core/parser.ts` (`isBlankLine`, exported and consumed by the blockquote, HTML
block, indented-code, list, paragraph and table parsers),
`src/lib/plugins/footnotes/footnote-definition.ts` (a private duplicate with the same body)

Both predicates ask `String.trim()`, which strips the whole Unicode whitespace set. GFM's blank line
is spaces and tabs only. So a line holding nothing but a non-breaking space, the commonest artifact
of a paste out of a word processor or a web page, reads as blank and splits one paragraph into two,
and a document whose only content is an NBSP parses to zero children. The ASCII vertical tab and
form feed are admitted on the same route.

**Repro:** paste a three-line paragraph whose middle line holds one U+00A0 and nothing else; the
editor shows two paragraphs where GitHub renders one. Parsing that line on its own yields a
document with no children.

**Why deferred:** narrowing to a space-and-tab test is byte-safe (the line stops terminating its
block and becomes a paragraph continuation, so its bytes stay inside one node's `raw`), but it
changes block structure on four axes at once: where a blockquote or paragraph ends, whether a list
is loose or tight, how far an indented-code run reaches, and when an HTML block terminates. That is
its own change with the parser owner and its own conformance pass, not a ride-along. The private
duplicate must move with it, which is the second half of the reason: the rule has two homes and
should have one, reachable from `$lib/plugin`.

### Closure cells are honesty-checked, not behavior-enforced, and one is already false

**Severity:** important (a shipped built-in's declared behavior is not the behavior; the false
claim reaches the published docs pack)
**Files:** `src/lib/schema/built-in-descriptors.ts` (`thematicBreak`'s `focus` and
`mergeBackspace` cells), `src/lib/schema/block-kind-descriptor.ts` (`blockFocus`),
`src/lib/editor-actions/block-edit-core.ts` (the branch that reads it),
`src/lib/schema/closure.ts` (`containerClosure`), the chrome-container registrations

A closure cell is prose the compiler cannot check. A revert-probe first showed the gap in the
abstract: dropping a directive-title container's `clipboard: implemented` override (falling to the
preset's baked `inherit-default`) leaves every suite green, so an override's protection is matrix
honesty, not a failing test.

**The 0.9.35 review found the live instance.** `thematicBreak` declares no `blockFocus`, so
`mergeWithPreviousInterior` reaches the non-editable arm and **deletes it on the first press**. Its
own closure cells say otherwise: `focus` claims "whole-block focus (focus-then-delete model)" and
`mergeBackspace` claims "caret-adjacent Backspace focuses, a second press deletes". `mermaid` is the
only kind that declares `blockFocus: 'whole-block'` and therefore the only one where those cells are
true. The design spec and the **published** plugin guide had been naming the thematic break as the
reference model an author should copy; that attribution is corrected, the descriptor and the
behavior are not.

**Fix direction:** a bootstrap coherence rule (the G1.24 family) making the pair unrepresentable: a
kind whose `focus` or `mergeBackspace` cell claims focus-then-delete must declare
`blockFocus: 'whole-block'`. That decides `thematicBreak` on its own: either it declares the field
and gains the behavior its cells promise, or the cells are rewritten to say "deletes on a
caret-adjacent Backspace". The sibling rule for the chrome-container case is the same shape
(`reservedChrome` declarers must carry a non-default `clipboard` cell), and the conformance battery
exercising the mid-title copy shape is its behavioral half.

**Why deferred:** the coherence rule is cheap, but choosing which way `thematicBreak` resolves is a
behavior decision on a built-in kind that the whole-block-focus documentation is written around, so
it wants the pass that owns the rule rather than a ride-along.

### Footnote reference numbering is O(widgets × leaves) per reactive flush

**Severity:** watch (sub-millisecond at real scale; superlinear only for a reference-dense document)
**Files:** `src/lib/plugins/footnotes/footnote-numbering.ts` (`assignFootnoteNumbers` walks every prose
leaf), `src/lib/plugins/footnotes/FootnoteReference.svelte` (each widget's `$derived` calls it independently)

Each mounted reference widget derives its superscript number by walking the whole document through
`assignFootnoteNumbers`, which inline-parses every prose leaf. The walk is not shared across a flush; it
re-runs per widget, so a reactive flush costs O(widgets × leaves). Measured ~1.04 ms worst case on a
40-paragraph document with 20 references (comfortably sub-keystroke), but the shape is superlinear: a
reference-dense region of hundreds of references over hundreds of leaves runs an order of magnitude past a
frame budget per keystroke.

A bounded, identity-keyed memo over the document cannot fix it: the `$state` document proxy is mutated in
place, so its object identity is stable across every edit, and an identity-keyed memo would hit on every
call and return a stale number map, breaking the live renumber the feature is built on (verified in the
Task 3 review).

**Fix direction:** a per-epoch shared computation (one `assignFootnoteNumbers` walk per flush keyed on a
content-version token every widget reads) once a real workload goes reference-dense. No such token reaches
a widget today: `linkStamp` tracks only the LRD signature rather than general edits, and the decoration
engine's general `editEpoch` reaches a `DecorationSource`'s `provide` and nothing else — which is exactly
why highlight-occurrences (a decoration source) could memoize this same walk shape and a reference widget
cannot.

**Why deferred:** the fix needs a content-version token on the widget surface, which is public plugin
surface and therefore a freeze-relevant addition, worth taking against a real reference-dense workload
rather than the synthetic shape. Sub-millisecond until one exists.

### Installed inline-rung consultation is unmeasured by the standing perf gate

**Severity:** watch (measurement gap; the per-consultation cost the entry once assumed is now
measured and bounded)
**Files:** `src/lib/core/inline/scan/index.ts` (the pre-switch prefix consultation, the
default-arm unreserved-rung consultation, and `needsScan`'s per-character probe),
`src/lib/test/perf/` (the standing harness installs no rung-registering plugin)

A registered inline rung adds a consultation the standing empty-registry gate never measures. Three
bundled rungs ship, on the two rung shapes:

- **Reserved-prefix** — footnotes' `[^` (0.9.33), consulted before the built-in `[` case, so every
  `[` in a scanned range pays a registry lookup plus a two-char prefix compare, within ranges
  `needsScan` already admits.
- **Unreserved** — emoji's `:` (0.9.34) and latex's `$` (a bare registration predating the ladder,
  riding its default rung), consulted in the scanner's `default` arm, so every occurrence pays a
  lookup plus a recognizer attempt. The directive text tier adds a second `:` rung wherever
  `activateDirectives()` runs.

**The entry's original cost model was wrong and is fixed.** It priced a consultation as
O(occurrences of the trigger), which assumed each consultation is O(1). Three of the four bundled
recognizers scanned to the end of the range before declining, so the real cost was quadratic in the
block: measured 2026-07-24 at growth exponent ~2.0, seconds per parse at 96 KB in one paragraph, on
ordinary content (`$HOME $PATH $USER` is a shell-documentation paragraph, not an attack). Each
recognizer now materializes its decline predicate once per block behind a bounded memo and looks it
up, so the stated model finally describes the code. What the entry always got right is that the perf
gate cannot see any of this: the measurements came from the adversarial pass, not the standing
ceilings.

The unreserved shape's cost is **not** confined to its trigger: unreserved triggers are held out of
`SPECIAL_CHARS`, so registering any one of them flips `needsScan`'s per-character probe on, and
every ordinary character in a scanned range then pays a map lookup before the fast bail decides. A
document with latex or emoji installed therefore runs a more expensive bail loop than the standing
ceilings measure, on every keystroke, not merely a denser trigger cost.

**Fix direction:** when a perf-harness pass next touches fixtures, install each rung shape and
measure it: a bracket-dense fixture under footnotes, a colon-dense one under emoji, a dollar-dense
one under latex — plus a **plain-prose** row under any installed unreserved rung, which is the row
that measures the bail-probe cost the current gate is blindest to. The trigger-dense half now has
growth bounds in the unit suites (each recognizer's `*-bounds` file), so what is still unmeasured
is the keystroke ceiling and the plain-prose bail row.

**Why deferred:** sub-millisecond at real scale, and cost-identical to the pre-ladder path on an
empty registry. The bail probe itself predates the ladder — latex's `$` has ridden it since inline
math shipped — so this is a standing measurement gap, not a ladder regression. Re-open when a
perf-harness pass next touches fixtures, or if a real workload holds a trigger-dense region under
an installed rung.

### Reveal into a collapsed container silently degrades (toc navigation, search)

**Severity:** minor (silent dead affordance; the honest-boolean floor holds — no crash, no strand)
**Files:** `src/lib/reactivity/publish-ref.svelte.ts` (`revealChildOrWait` — degrades when the
target index is outside the current window), `src/lib/editor-actions/container-block-component.ts`
(`revealByPath`), `src/lib/plugins/details/DetailsBlock.svelte` + the container factory's
`isCollapsed` window clamp

A collapsed collapsible container (`details`, an admonition) clamps its render window to the chrome
row (child 0), so a body child never mounts. A reveal targeting a body child of a collapsed
container therefore degrades at the reveal seam: `revealByPath` → `revealChildOrWait` finds the
index outside the live window (`isInWindow` false) and returns immediately, `scrollTo` resolves
`false`, the anchor clears — no mount, no scroll, no error. The class is "reveal into a collapsed
container", not toc-local:

- **toc side (symptom):** a heading inside a collapsed `details` IS listed by the outline walk (the
  walk reads the whole CST regardless of collapse view-state), but clicking its entry silently
  no-ops.
- **search side (sibling):** search's `revealActive` binds `reveal` to the same `rects.scrollTo`
  (`Editor.svelte`), so a find match inside a collapsed container navigates to nothing the same way.
  A future `#fragment` link resolution would share the class.

Nothing in the reveal path force-expands a collapsed ancestor.

**Fix direction:** teach the reveal seam to expand collapsed ancestors before mounting the target
(the `hidden=until-found` / Obsidian precedent), designed against the collapse-probe contract
(`reservedChrome.isCollapsed` — the same probe the clamp reads) so the expansion is driven by the
declared collapse state, not a per-kind special-case.

**Why deferred:** a reveal-machinery behavior change wants its own design pass (which claimant
expands, whether the expansion is transient or committed, its undo semantics). The honest-boolean
floor holds today, so the symptom is a dead click, not corruption.

### Reveal anchor is a single process-global slot with no per-claimant ownership

**Severity:** watch (rare cross-claimant residual; no corruption, no strand within a block)
**Files:** `src/lib/cursor/reveal-anchor.ts` (the single-target slot), `src/lib/plugins/toc/navigation-queue.ts`
(the per-block narrowing), `src/lib/editor-rects.ts` (`scrollTo` set/clear)

The reveal anchor holds one target with no per-call ownership. Two reveals racing within the settle
window (~12 ticks) clash on the one slot: the later `set` overwrites it, and an earlier claimant's
terminal `clear()` (a `!landed` or `'center'` scroll) can nuke a later claimant's pin. Per-block
navigation serialization (`navigation-queue.ts`) narrows this to one claimant per block, but two
DIFFERENT toc blocks — or a toc navigate and a search reveal — still share the slot. Repro shape: a
rapid cross-block double-click driving two toc blocks' navigations inside the settle window.

**Fix direction:** per-call anchor ownership (a claim token the `clear()` checks, so a stale
claimant cannot clear a fresher pin), or seam-level serialization at `scrollTo` itself (one in-flight
reveal per editor instance) instead of each caller serializing its own.

**Second coarseness, same redesign:** `scrollTo` accepts any path, but the anchor it sets holds only
the target's TOP-LEVEL ancestor (`use-container-windowing.svelte.ts` narrows to `target.path[0]`, and
`list-windowing.svelte.ts`'s `correctAnchor` re-asserts a top-pin on that index). Inside the settle
loop the per-tick `scrollIntoView` refine gets the last word, so a nested target resolves correctly —
verified live: a `[[toc]]` inside a blockquote navigating to a nested heading in a 163-block windowed
document lands it in view. But `'nearest'` deliberately KEEPS its anchor after resolving, and what
survives holds the container, not the heading: a container taller than the viewport with an image
decoding below it on a later measure pass would have the anchor re-assert the container's top and
push the already-resolved nested target back out of view. Same fix (per-call ownership carrying the
full target path, not a narrowed index), so it is folded here rather than filed apart.

**Coverage gap:** no test drives a nested `scrollTo` target at all — `rect-api.spec.ts` and
`scroll-to-settle.spec.ts` both use top-level paths, and `toc-navigation.spec.ts` pins nested
_listing_ only. A nested-target e2e (tall container, nested heading, assert the target stays in view
past the settle) belongs with the fix.

**Why deferred:** honest-failing (the loser's target just isn't held — no crash, no corruption; the
nested residual needs a tall container plus a late decode), and the ownership model wants a second
real consumer navigating concurrently to shape it; designing per-call ownership against a single
caller risks the wrong abstraction.

### The find bar carries its active-match position across a document swap

**Severity:** trivial (navigation position only; the match set and every overlay are correct)
**Files:** `src/lib/search/search-state.svelte.ts` (`rescan`'s downward-only clamp)

`rescan()` clamps `activeIndex` only when it overruns the new match set
(`if (activeIndex >= matches.length) activeIndex = 0`). A `source` prop swap under an open find bar
now re-scans correctly, but an active position carried from the previous document survives when the
new one has at least as many matches: navigate to `3 / 3`, swap to a document with five matches, and
the bar reads `3 / 5` on a document the user has never navigated. Surfaced by the epoch fix that made
the swap re-scan at all; the position was equally carried before, behind a set that never updated.

**Fix direction:** restart navigation at the first match on an epoch-driven rescan, the way
`setQuery` already does for a new query — the swap is a new document, so the position means nothing.
Option toggles must keep their clamp-only behavior (they deliberately hold the user's place).

**Why deferred:** it is a behavior change to search navigation semantics, not a regression, and it
wants deciding alongside whether an in-place edit should also restart navigation (today it does not,
by the same clamp).

### adjacent-widget-boundary click-snap helper flaked once under full-battery contention

**Severity:** watch (1-of-2 full-battery repro at the 0.9.35 ship gate; isolation and rerun green)
**Files:** `src/lib/e2e/tests/blocks/image/adjacent-widget-boundary.spec.ts` (`snapAfterFirstWidget` —
mouse click at a computed point, 5s snap-indicator wait)

At the 0.9.35 ship battery, both specs using the click-snap helper failed together (`.md-snap-after/.md-snap-before`
resolved to 0 for the full 5s); the same specs pass 3/3 in isolation and the immediate full-battery
rerun was green. The failure window contains M3's pointerdown anchor-clear wiring
(`cursor/reveal-anchor.ts`), which is a suspect, not a finding.

**One clean data point since.** The 0.9.35 review ran two full e2e batteries, both green with zero
flaky and no retry of any spec, and confirmed `retries: 0` in the Playwright config with no CI
override, so a recurrence reads red rather than being silently retried away, and neither battery
saw one.

**Fix direction:** if this reds again (CI or a local battery), investigate the anchor pointerdown
listener's interaction with click-caret placement under load FIRST, before any timeout raise; a
timeout raise without a mechanism is quieting the checker.

**Why deferred:** non-deterministic 1-of-2 repro; no mechanism established; the sibling
battery-order-flake precedent records falsified causes, so this entry starts with its protocol.

## Code structure

### `parseInline` returns plausible wrong output instead of throwing on the wrong arity

**Severity:** minor (silently wrong output on a public export; freeze-surface shape)
**Files:** `src/lib/index.ts` (the export), `src/lib/core/inline/scan/index.ts` (the scanner it
aliases)

The function takes a source string plus the start and end of the range to scan. Called with only the
source (the natural first guess, and the one a JavaScript consumer or an `any`-typed call site can
make without a compile error), the missing bounds flow through every comparison as `undefined`, the
scan is skipped, and the caller gets back one text node holding the whole string. That is a
plausible-looking result: no throw, no warning, and the inline structure the caller asked for is
silently absent. This review found it by making the mistake, and only noticed because the wrong
answer briefly falsified a real finding.

**Repro:** call `parseInline('a *b* c')` and observe `[{ kind: 'text', text: 'a *b* c' }]` rather
than an emphasis node or an error.

**Why deferred:** the fix (reject a call that does not carry both bounds) is a behavior change on a
frozen-at-1.0 export, so it belongs to the freeze cut's surface pass rather than to a records commit.
Cheap now and breaking later, which is what puts it on that list rather than this one.

### `emptyParagraph`'s line-ending default is the next N+1 hazard

**Severity:** minor (no live defect; a shape that makes the next instance compile clean)
**Files:** `src/lib/tree-operations/node-ops.ts` (`emptyParagraph`'s defaulted `lineEnding`
parameter)

The 0.9.35 line-ending family was one rule reimplemented at N sites, and its second half was seven
paragraph-mint sites that took this parameter's `'\n'` default and therefore downgraded a CRLF
document. Every live site now passes the document's ending explicitly. The default that let them all
be wrong is still there, so a new mint site that omits the argument compiles clean, reads as
correct, and reintroduces the class, with no guard able to see it, because the call-site scan
cannot reach a defaulted parameter.

**Fix direction:** the enforcement-ladder climb the family's own miss-analysis points at: make the
parameter required, so a mint site must answer the question. The one caller that genuinely mints
into an unknown document (an empty source) already computes an ending to pass.

**Why deferred:** it is a small mechanical change across every mint site, and it wants to land with
the wider seam question the family raised (whether the ending should be carried by the scope rather
than passed per call) rather than as a lone signature edit.

### A destructive key at a mid-cell `<br>` edge needs a second press, which then deletes a non-adjacent byte

**Severity:** trivial (niche gesture; byte-safe and round-trip stable throughout)
**Files:** `src/lib/components/blocks/table/TableCellBlock.svelte` (the cell's
`enterWidget` dep to the caret-edge dispatch)

Threading the caret-edge dispatch through cells for inline reveal made it meet a
`<br>` — a non-reveal widget with no cell affordance (images render as alt text).
The cell's `enterWidget` sends non-reveal kinds to a caret step-over rather than the
prose image select-then-delete path, which had no cell paint and stranded focus.
Because `enterWidget` receives only the entry side, not the key, a Backspace/Delete
at a `<br>` edge takes that same non-deleting step-over: press #1 hops the caret to
the widget's far edge (no byte deleted), and press #2 — the caret now past the
widget — deletes a NON-adjacent byte, two positions past where the user pressed; a
Delete #2 at the trailing edge can land in the NEIGHBORING cell, and the caret
transiently parks on an off-cell DIV mid-gesture. Every end state is byte-safe and
round-trips. This is the pre-existing native `<br>`-in-cell behavior (0.9.14, when
Shift+Enter cells gained `<br>`); the step-over now shields the clean first press,
which previously stranded focus. Only reachable mid-cell — at the cell's text
boundaries the plan owns the key.

**Fix direction:** give the cell a key-aware caret-edge path for non-reveal
widgets — a one-press atomic delete on Backspace/Delete, a caret hop on arrows —
which needs the dispatch to hand `enterWidget` the gesture kind (or a separate
destructive hook).

**Why deferred:** bundled with the whole-table keymap migration below, since both want the cell
keydown path expressed declaratively rather than special-cased, and every end state here is
byte-safe and round-trip stable.

### Whole-table keyboard reorder (Alt+↑/↓) is unavailable

**Severity:** minor (a11y; table blocks only)
**Files:** `src/lib/components/blocks/table/cell-keydown-plan.ts`, `src/lib/schema/block-kind-descriptor.ts` (`table` registration), `src/lib/components/blocks/table/TableBlock.svelte`

Alt+↑/↓ now reorders fencedCode, thematicBreak, paragraphs, and list items among their siblings via the `block.moveUp/moveDown` keymap, matching the drag handle's tooltip. A table has no non-cell focus surface, and inside a cell Alt+↑/↓ is already bound — in `cell-keydown-plan.ts`'s hard-coded `SHORTCUTS` — to ROW reorder, so there is no free gesture to reorder the whole table block, and its drag handle's keyboard equivalent is missing.

**Why deferred:** the table's structural chords live in a second, hard-coded dispatch (`cell-keydown-plan.ts`) instead of the declarative `keymap` the other kinds use, so they also bypass the consumer `keybindings` override prop. Expressing a whole-table `block.moveUp/moveDown` cleanly is part of migrating the table chords onto the declarative keymap — its own deliberate change (the consumer-guide's rebindability promise should be scoped or fulfilled with it). Code and thematic-break keyboard reorder shipped; the table case is flagged here.

### Container shim hardcodes the component `editable` flag

**Severity:** minor (latent capability gap; no current misbehavior)
**Files:** `src/lib/editor-actions/container-block-component.ts` (the shim),
`src/lib/editor-actions/plugin/container.ts` (`ContainerBlockDeps`)

The container `BlockComponent` shim hardcodes `editable: true`, so a plugin container cannot declare
its surface non-editable (an opaque diagram whose only edit path is its own UI). No runtime consumer
reads the component-surface `editable` flag today — merge (`merge-rules.ts`) and search
(`document-scan.ts`) key on the descriptor's `editable` — so this is a contract-correctness gap, not
a bug: mermaid works at `editable: true`.

**Fix direction:** an `editable` override on `ContainerBlockComponentDeps` threaded from the factory,
the kind declaring the value on its descriptor and the shim reading it — but only after settling
which gates should read the component flag versus the descriptor flag (today only the descriptor
flag has readers).

**Why deferred:** the command→component channel wall this entry once bundled has shipped (a minted
command reaches the mounted component through `ctx.hooks`, threaded by the container/leaf factories'
`commandHooks` getter; mermaid migrated off its node→hooks map). The residual `editable` flag has no
reader, so the fix is cosmetic until a consumer needs a non-editable container surface.

## Test coverage

### The property suites cannot reach a plugin rung, the block-indent boundary, or any shape at scale

**Severity:** minor (coverage shape; the specific defects it hid are fixed and pinned)
**Files:** `src/lib/test/invariants/round-trip.property.test.ts` and its siblings (none install
plugins), `src/lib/test/invariants/arbitraries/gfm.ts` (`arbGfmDoc`),
`src/lib/test/invariants/arbitraries/raw-string.ts` (`lazyQuoteShapes`),
`src/lib/test/invariants/inline-total-coverage.property.test.ts` (G2.11's kind vocabulary)

The parse-loop hang a tab-indented `> [!NOTE]` produced was invisible to every generator, for two
compounding reasons. No suite under `src/lib/test/invariants/` installs plugins, so the property
tests parse through the built-in grammar alone and no plugin opener's return has ever been under
property coverage — the surface where a third-party opener bug would live. And the generators cap
out below the boundary regardless: `arbGfmDoc` composes every block at column 0 (its only
indentation is list-item continuation padding, and it emits no tabs), while `arbRawString`'s
blockquote vocabulary tops out at a 3-space indent with no 4-space or tab-before-`>` shape. So the
0–3-versus-4 block-indent rule — the CommonMark boundary that separates a blockquote from indented
code — is outside the reachable input space for built-ins too.

**The same suites are also capped far below every failure scale.** `arbRawString` tops out around a
few hundred bytes and `arbGfmDoc` at a handful of short blocks, while every complexity defect the
0.9.35 review measured lives three or four orders of magnitude past that: the quadratic inline
declines, the argument-spread `RangeError` at tens of thousands of matches, the render recursion's
stack overflow. No flood, no overflow, and no superlinear growth is expressible in the input space
at all, so the marquee round-trip invariant is structurally blind to the class. The inline-rung half
is worse than bounded: G2.11's kind vocabulary is derived from the built-in union, so installing any
rung makes the property throw on its vocabulary check before it can test tiling, which is why every
grammar shipped in 0.9.33-0.9.35, the newest and least-audited code, sits outside the invariant.

**Fix direction:** four independent additions, in value order. Run one round-trip property pass with
the bundled plugins installed, so plugin openers and inline rungs are covered by the marquee
invariant rather than by per-kind fixtures only. Add one large-input size tier at a low run count,
which reaches the scale the complexity defects live at without slowing the fast tier. Give the raw
and GFM arbitraries a leading-indent dimension (0–4 spaces and a tab before a block marker) so the
block-indent boundary becomes reachable. And split G2.11's vocabulary assertion from its contract
assertion, widening the vocabulary to registered plugin kinds.

**Why deferred:** the indent dimension widens the corpus for every property suite at once and wants
its own measured pass (the suites are seeded and run 1000 cases each), the plugin-installed pass
needs a decision on registry isolation between property runs, and the size tier needs its run count
chosen against the suite's wall-clock budget. None is a prerequisite for the defects already pinned
directly.

### The block-component mount harness exists but covers a minority of block components

**Severity:** minor (coverage shape; the pure layer below these components is well covered)
**Files:** `src/lib/test/harness/mount-context.ts` (the harness), the block components with no test
at their own level: `BlockquoteBlock`, `ListBlock`, `ListItemBlock`, `TableBlock`, `TableRowBlock`,
`TableCellBlock`, `DirectiveContainerBlock`, `ThematicBreakBlock`

The harness assembles every context a block component reads, so mounting one in isolation is a few
lines. It is used by a small handful of suites. The components it is not used for include several of
the repo's highest bugfix-density files, and the 0.9.35 review's own miss-analysis named this shape
twice: the pure helper is tested, the entry layer that produces its inputs is not, so a helper's
documented refusal path is pinned by its own unit test while nothing pins what that refusal means at
the caller. Where a component has no test at its own level, that gap is total.

**Fix direction:** for each pure helper with a documented refusal path, one test at a caller
asserting the contrapositive, which for a component-level caller means a mount through the harness.
Prioritize by bugfix density rather than by component size.

**Why deferred:** this is a suite-shaping program rather than a fix, and it wants the pre-1.0
re-audit's unit-suite pass to scope it, since that pass is the one artifact class the 0.9.35 review did
not cover, so its findings should set the priority order rather than this entry guessing it.

### G1.27 may false-fire on Safari's duplicate compositionend

**Severity:** watch (no field report yet; Chromium-only test coverage)
**Files:** `src/lib/components/blocks/editable-surface.ts` (`onCompositionEnd`),
`src/lib/invariants/inline-transitions.ts` (`checkCompositionEndPaired`)

Safari has shipped duplicate `compositionend` fires per composition (WebKit 218603 among
others). The second end would reach G1.27 with `composing` already cleared and warn on a
legal-if-buggy browser sequence. If a field report shows it, relax the predicate from
per-window pairing to once-per-focus: track "saw a start since this element gained focus"
and fire only when even that is absent — the wired-end-without-start bug it exists to catch.

**Why deferred:** the relaxation trades real detection power against a browser behavior nothing in
the suite can exercise, and no field report has arrived. Loosening a dev predicate on speculation is
the wrong direction on the enforcement ladder; a warn on a legal-if-buggy sequence is the cheaper
failure.

## Plugin containers

### The admonitions blockquote grammar still over-accepts indent outside the marker rule

**Severity:** minor (a conversion false negative and a body-strip divergence; neither can hang or
break byte round-trip)
**Files:** `src/lib/plugins/admonitions/gh-alert.ts` (`QUOTE_LINE`, `stripQuoteMarker`),
`src/lib/core/parsers/blockquote.ts` (`matchBlockquote`, `remapStrippedLines` — the rule they
should agree with)

The marker rule was capped at CommonMark's 0–3 space block indent when its unbounded form turned
out to hang the parse loop. Two siblings in the same file keep the unbounded `[ \t]*` indent, and
neither can produce a non-advancing opener, so both were left alone:

- `QUOTE_LINE` decides "was the previous line already inside a blockquote" in the `source → source`
  transform. Over-broad, so an indented-code line that happens to start with `>` suppresses
  conversion of the alert that follows it — a false negative in a legacy path.
- `stripQuoteMarker` strips a quote prefix from lines the extent scan already claimed. The built-in
  gates the same strip on `matchBlockquote` and passes lazy-continuation lines verbatim; the plugin
  strips unconditionally, so `> [!NOTE]\n\t> body\n` yields a `body` paragraph child where the
  built-in blockquote would keep the tab-indented bytes.

**Fix direction:** align both with `matchBlockquote`, but not as a ride-along — tightening
`stripQuoteMarker` changes an alert's child structure (paragraph → indented code) and therefore its
post-edit rebuild bytes, so it needs its own red-first pin and its own decision on what a lazy
continuation inside an alert body should become. The wider question underneath is whether the
plugin's body strip should reuse the built-in's `remapStrippedLines` gating instead of forking it.

**Why deferred:** the hang class is closed (the opener declines when the extent claims nothing), and
these two are byte-safe. Neither has a reported symptom, and the `stripQuoteMarker` half is a
behavior decision rather than a defect.

### Search replace skips matches inside childless opaque containers

**Severity:** minor (replace parity; find/highlight/navigate work today)
**Files:** `src/lib/editor-actions/search-replace.ts`

A childless opaque container (e.g. a mermaid block) is scanned as a leaf, so search finds,
highlights, and navigates to matches inside its raw. Replace skips those matches by design
(`isReplaceable` excludes container nodes): `replaceOne` no-ops, `replaceAll` excludes them, and
`replacedCount` reports only real replacements. The blocker is NOT metadata drift — the replace
path is reparse-based (substitute into a private clone's `raw`, then `parse(child.raw)` into
fresh nodes), never an in-place write, so the G1.12/G1.13 staleness probes never see it. The real
hazard is KIND-STABILITY: a substitution that breaks the opener fence line reparses to a different
kind (a mermaid block silently becoming a plain `fencedCode` or paragraph) — a hazard already
accepted for `fencedCode` leaves, but surprising to apply silently to a plugin's opaque kind.

**Fix direction:** a kind-aware write path — the kind translates a raw-range edit into a metadata
update (for mermaid, a `code` rewrite) and the ceremony rebuilds `raw` from it, so a replacement
can never flip the kind. `buildSubtree` now reparses through the instance grammar
(`parse(child.raw, { grammar })`), so a future kind-aware fix no longer inherits a
grammar-threading gap.

**Why deferred:** fold into the post-1.0 container editable-flag / opaque-write work (see
"Container shim hardcodes the component `editable` flag").

### Cross-block copy STARTING mid-chrome loses the container wrapper

**Severity:** minor (clipboard fidelity; container kind lost on paste)
**Files:** `src/lib/selection/clipboard-text.ts` (`collectCrossBlockText`)

The closer-synthesis fix covers a copy whose END lands mid-chrome (title/summary): it
synthesizes a chrome-only container and reparses to the same kind with an empty body. The
mirror direction — a copy that STARTS mid-chrome and extends into the body (and possibly past
the container) — is a distinct class the synthetic-chrome-only design cannot serve. The chrome
tail emits wrapper-less and the selected body is collected flat, so no opener or closer wraps
it. Repro: `collectCrossBlockText` from `:::note Ti|tle` into the body below yields
`"tle\nBody1\n\nBody2\n\nBel"`, which reparses to three bare paragraphs — the `note` kind gone.

**Fix direction:** a chrome-only synthetic node is semantically wrong here (empty body would
strand the selected body as top-level blocks after the container). Faithful bytes need the
chrome tail emitted as the container opener AND a synthesized closer injected where the walk
exits the container — a `collectCrossBlockText` structural change (container-exit tracking),
not the bounded closer-synthesis the END case uses.

**Why deferred:** the END direction is the shipped, reachable-today gesture. Fold the START
direction into the post-1.0 clipboard/hook generalization with the container-exit walk change.

### Container components re-export the component surface member-by-member

**Severity:** trivial (authoring ergonomics; every container is guarded)
**Files:** `src/lib/components/BlockHost.svelte` (ref binding); every container component

A container block re-exports each `ContainerBlockComponent` member as its own `export const` so
`bind:this` on `<Comp>` in BlockHost captures the full surface — Svelte 5 instance exports are
individual top-level declarations, with no spread. That is ~11 identical lines in every container
component. Every container, built-in and bundled-plugin alike, now ends
the block with a `satisfies ContainerBlockComponent` guard, so a forgotten member is a compile
error everywhere (the built-ins' redundant `!` non-null assertions are gone with it). The
duplication itself remains. Read the guard's own call sites for the list a migration must cover
rather than an enumeration here, which has already drifted once as plugins landed.

**Fix direction:** let a container expose ONE well-known instance export (its `containerApi`) and
have BlockHost read `ref.<that>` as the `BlockComponent` surface it stores and dispatches through
(`publishRefSlot`, `SelectionOverlay`, the parent's `innerBlockRefs` walks). Collapses the block to a
single line, but changes ref normalization for the single most load-bearing dispatch component and
the whole ref chain, across every block kind — blast radius only the simulation + VR suites observe.

**Target:** 1.2 — carry it with the container-seam ergonomics pass, not as a standalone pre-freeze
change to the ref chain.

### Footnote definition body ergonomics: Enter-at-end and non-prose-first-child residuals

**Severity:** minor (edge ergonomics; byte round-trip and the common `[^label]: <prose>` shape hold)
**Files:** `src/lib/plugins/footnotes/footnote-definition.ts` (`scanDefinitionEnd`, `rebuildFootnoteDefRaw`),
`src/lib/plugins/footnotes/FootnoteDefinition.svelte` (the ambient marker forward)

The footnote-def is a strip container whose body is real child blocks, and Enter/split inside the body
inherits the shared blockquote split override (`createContainerBlock` always wires
`createBlockquoteOverrides`). The `footnote-ops` simulation now pins that a mid-child split grows the
container's children and never the document root (the boundary the Task 2 review flagged untested). Two
edges remain:

- **Enter at the end of the last body child** mints a trailing empty child, and a footnote-def's empty
  continuation line carries no four-space indent, so `scanDefinitionEnd` drops it as a document blank on
  reparse, and the live two-child tree then diverges from its one-child reparse. This is the documented
  Enter-at-end split class (see "Enter-at-end can produce a live block pair…") reaching inside the strip
  container: the split mints a single-newline, indent-free successor the reparse does not honor. The sim
  splits mid-child to pin the in-container boundary without tripping it, so the end-split sub-case is
  unpinned.
- **A non-prose first child omits the ambient marker.** Only `TextEditableBlock` (which paints the marker)
  and `ListItemBlock` (which re-forwards it) consume the `ambientPrefix` prop, so a degenerate definition
  whose first child is a list or code block (`[^a]:\n    - item`) forwards `[^a]: ` to a child that ignores
  it and the marker is silently absent. This is the platform's inherited `ambientPrefixForFirst` behavior,
  shared with listItem, not a footnote-introduced one; GFM footnote definitions are effectively always
  `[^label]: <prose>`, so the edge needs a constructed input.

**Fix direction:** the Enter-at-end edge folds into the deferred splitNode separator design (a kind-aware
blank-line separator at the split choke point); the marker edge, if ever tightened, should tighten for
listItem in the same pass, since both inherit the same prefix-forward machinery.

**Why deferred:** byte round-trip holds throughout, and both edges need a constructed input the common
footnote shape never produces; the Enter-at-end fix is the same deferred splitNode design pass its
top-level sibling entry already owns.
