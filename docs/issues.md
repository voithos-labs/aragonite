# Known Issues

Log of known editor issues. Each entry carries severity, affected files, a description,
reproduction (where relevant), and either a **Target** version (if scheduled via the roadmap)
or a **Why deferred** rationale (if not). Remove entries when shipped.

## Core editing

### Content typed into a code block can still break its fence

**Severity:** important (byte corruption; the block absorbs the rest of the document on reload)
**Files:** `src/lib/components/blocks/code/CodeBlock.svelte` (the beforeinput fence guard and
the auto-pair arm — both police WHERE an edit lands, not WHAT it writes),
`src/lib/components/blocks/code/code-beforeinput.ts` (`computeAutoPair` closes a typed backtick
into a pair), `src/lib/components/blocks/code/code-paste-surface.ts` (paste bumps the opener's
fence length when the pasted text carries a matching run — the shape of a fix, applied to one
character class)

Where an edit may land is settled: the fence marker runs, the opener indentation and the two
body line endings are structure, and every gesture that would rewrite them is clamped onto the
body. What an edit may _write_ into the two content regions is not policed, and two characters
break the fence from inside a region the contract calls safe:

- a backtick typed (or pasted) into a **backtick fence's info string** — GFM forbids backticks
  there, so the opener stops being a fence, the block demotes, and its closer becomes the
  opener of a fence that absorbs everything after it.
- a **fence run typed into the body** at column 0 closes the block early, and the trailing
  half of the old body becomes a fence that absorbs everything after it.

Both parser-verified (source on the left, resulting block sequence on the right):

````
"```j`s\nconst x = 1\n```\n\n# Heading\n"   → paragraph | fencedCode="```\n\n# Heading\n"
"```js\n```\nconst x = 1\n```\n\n# Heading\n" → fencedCode | paragraph | fencedCode="```\n\n# Heading\n"
````

**Repro:** in a fenced code block, put the caret in the info string after the language and type
a backtick; save and reload.

**Why deferred:** this is character-validity, not structure — a different rule that has to cover
typing, paste and IME uniformly on both regions, and whose fix is a product decision (refuse the
character, or bump the fence the way paste already bumps it). The structural contract is
complete and independently enforced; bolting a character rule onto its predicate would blur two
rules into one guard. The body half is the same family as the container terminator-collision
work, which has its own conformance cell.

### Caret navigation still stops on a code block's non-editable fence lines

**Severity:** minor (no corruption; silent no-op with no feedback)
**Files:** `src/lib/cursor/visual-lines.ts` (the arrow-boundary tier counts a fence line as a
visual line like any other), `src/lib/selection/shared-keydown.ts` (the ArrowUp/ArrowDown
boundary test that reads it), `src/lib/components/blocks/code/CodeBlock.svelte` (`onPointerDown`
— a click seats the caret natively, with no seam to clamp)

The fence marker runs are structure: typing, deleting and pasting inside one are refused. The
class is what happens to a caret that ends up on one anyway, and it has two halves.

**Fixed:** caret _landings_. Every programmatic door on the code surface (`focus`,
`focusAtColumn`) clamps onto editable content, so a landing can always type. That half was found
by the cross-container merge fallback, which moves focus to the block's END — the closer run —
and whose e2e proved the landing typable by typing a character that then went nowhere.

**Still open:** caret _navigation and clicks_. ArrowDown from the last body line stops on the
closer line, ArrowUp from below stops on it too, and a click lands wherever it is aimed; at all
three the caret sits where every keystroke is silently inert. Three independently written e2e
specs had encoded the opposite assumption (two ArrowDown, one paste at `focusBlockEnd`), which
is how the class surfaced.

**Why deferred:** the remaining half is a navigation change, not an editing one — the
visual-line math, the sticky column, Home/End, and a pointerup re-seat that must not collapse a
drag-selection all have to agree on a caret that skips two lines. The same question applies to
any block whose rendering has non-editable structural lines, so it is worth deciding once for
that class rather than for code alone.

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

**Second instance — a kind DEMOTION does not reflow the block below it.** Typing any character
at raw offset 0 of a heading demotes it to a paragraph; when the block below was tightly joined
(no blank-line separator, which is how a typed `heading`→`paragraph` cadence leaves it), that
neighbour is now a lazy continuation of the demoted block and a reload shows one paragraph
where the live tree holds two. Same class, a different producer: the split path mints a missing
separator, this one invalidates an existing tight join by changing a kind. A fix would have to
rescan forward from a block whose kind changed, which is the same design pass.

**Why deferred:** byte round-trip holds and the live session is self-consistent; the
divergence needs a save→reload boundary to observe. The simulation reaches the class as of the
range-interrupt family (`e2e/simulation/gestures/range-interrupt.ts`) — a caret landing at
offset 0 of a tightly-followed heading reds the parse-convergence oracle — so that family
places its caret-pinned landings at interior offsets rather than manufacturing this class
under a probe that is testing something else.

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

### `navigator.clipboard.readText()` did not settle on its first use under wry

**Severity:** watch (observed once, not reproduced; a hang defeats the `catch` that guards it)
**Files:** `src/lib/components/blocks/table/TableCellBlock.svelte` (the cell menu's Paste arm)

Measured in the real limestone desktop app (Tauri v2 + wry + WebView2, Windows), in one
session, in this order: `permissions.query({name: 'clipboard-read'})` reported `prompt`;
`readText()` called from a real click handler never settled, neither resolving nor rejecting, at
3s and again at 12s, while a `writeText` in the same handler resolved; later in the same session
the cell menu's Paste worked; after that the permission read `granted` and a bare `readText()`
resolved.

What granted the permission was not isolated, and whether a fresh WebView2 profile stalls the
first call was not retested (that would mean clearing a real user profile). The reason it is
ledgered anyway: the call site wraps the await in a `try`/`catch` that degrades to a no-op, and
a `catch` covers a rejection but not a promise that never settles. If the first-call stall is
real on a fresh profile, that menu item hangs silently instead of degrading.

**Fix direction:** race the read against a timeout so the no-op degradation covers a stall as
well as a rejection. Confirm the stall on a clean profile first — a fix aimed at a
mis-attributed cause is worse than the watch.

**Why deferred:** one observation, no reproduction, and the reproduction attempt costs a real
user profile. The Tauri example app the roadmap plans is where a clean profile is free.

### The footnote definition scan models no lazy continuation

**Severity:** minor (conformance divergence on an unindented non-blank line inside a definition;
byte round-trip holds)
**Files:** `src/lib/plugins/footnotes/footnote-definition.ts` (`scanDefinitionEnd`)

The scan continues a definition on a blank line or a four-space/tab-indented line and stops on
anything else. cmark-gfm stops the container on the same rule but then applies CommonMark's lazy
paragraph continuation, so an unindented non-blank line joins the definition's still-open
paragraph instead of starting a sibling block. `blockquoteExtent` and the list parser both model
that state; this scan does not.

**Repro:** a definition line, then a line holding one U+00A0 and nothing else, then a four-space
indented line (`[^a]: one` / `<NBSP>` / `    two`). It parses to a one-line definition plus a
sibling paragraph; GitHub renders one definition holding `one`, the NBSP line, and `two`. Any
unindented non-blank line reproduces it — the NBSP is only what makes the shape reachable by
paste. Spelled as a literal character the repro is invisible and retypes as an ordinary blank
line, which does NOT reproduce: a blank line is absorbed and the definition continues.

**Fix direction:** lift the lazy-continuation **loop**, not the predicate, and land the seam with
this fix rather than before it. `blockquoteExtent` is already most of it: track paragraph-open
state and absorb a line only while it is open, with the sibling-opener test injected per
container. That injection is load-bearing — this opener registers `interruptsParagraph: false`,
so `lineInterruptsParagraph` will not report a following `[^b]:` line, and a caller that did not
supply its own opener test would lazily swallow the next definition. Extracting only
`wouldKeepParagraphOpen` (two copies today, blockquote and list) would leave the third caller
free to reimplement the state wrong, which is the defect ledgered here. If the seam generalizes
to a container extent, decide whether it replaces or joins `blockquoteExtent` on the plugin
barrel **before the freeze cut** — after it both are frozen and the duplicate is permanent.

**Why deferred:** found while narrowing the blank-line predicate (0.9.36), which made the shape
reachable but did not create it; the fix is a state model in a plugin opener, not a ride-along on a
core predicate change.

### Markdown whitespace is still Unicode whitespace outside the blank-line rule

**Severity:** minor (block structure diverges from GFM on a paste artifact; byte round-trip holds)
**Files:** `src/lib/core/parsers/thematic-break.ts` (`matchThematicBreak`, `text.trim()`),
`src/lib/core/parsers/paragraph.ts` (`matchSetextUnderline`, `\s*$`),
`src/lib/core/parsers/list.ts` (`matchListItem`, `[-*+]\s+`),
`src/lib/core/inline/scan/autolinks.ts` (`isValidLeadingBoundary`, JS `\s`)

0.9.36 narrowed the blank-line predicate to GFM §2.1's space-and-tab, but the sibling grammar rules
still ask `String.trim()` or JS `\s`, both of which admit the whole Unicode whitespace set. GFM is
ASCII throughout: §4.1 and §4.3 allow only spaces or tabs after a thematic-break run and a setext
underline, §5.2 requires a bullet marker to be followed by one or more spaces or tabs, and §6.9's
autolink boundary is whitespace as cmark-gfm's ASCII-only `cmark_isspace` defines it.

**Repro:** five shapes, each a line carrying one U+00A0 where the spec allows only a space or tab.
Written with `<NBSP>` for the character, checked against commonmark.js:

| Source               | aragonite                         | GFM       |
| -------------------- | --------------------------------- | --------- |
| `***<NBSP>`          | `thematicBreak`                   | paragraph |
| `<NBSP>***`          | `thematicBreak`                   | paragraph |
| `a` then `===<NBSP>` | `setextHeading`                   | paragraph |
| `-<NBSP>a`           | `list` / `listItem` / `paragraph` | paragraph |
| `*<NBSP>**`          | `list` / `listItem` / `paragraph` | paragraph |

The inline case is the mirror: `x<NBSP>www.example.com` autolinks here, where cmark-gfm's ASCII-only
space test refuses the boundary and leaves it literal.

**Fix direction:** one sweep over `trim()` and `\s` in the block openers and the autolink boundary,
each narrowed to the ASCII class its spec clause names, with the same four-axis conformance
treatment the blank-line change got (`test/gfm-conformance/blank-line-axes.test.ts` is the pattern:
pin the block outline against commonmark.js, assert byte round-trip per fixture).

**Why deferred:** pre-existing and byte-safe. Each rule moves block structure on its own axis, so
this is its own conformance pass rather than a ride-along on the blank-line change, which is exactly
the reason that change was not itself a ride-along.

### The bare-email autolink diverges from cmark-gfm on the address boundary

**Severity:** minor (conformance divergence at the local-part boundary; the domain scan itself is
cmark-exact)
**Files:** `src/lib/core/inline/scan/autolinks.ts` (`matchBareEmailAutolink`, `EMAIL_LOCAL`,
`isValidLeadingBoundary`), `src/lib/core/url-policy.ts` (`ALLOWED_HREF_SCHEMES`)

Two halves, deliberately in one entry: the email form should be decided once, and written as a flat
list of five divergences it reads as a bug backlog and invites someone to "fix" a design decision.

**Half one — deliberate, revisit only on a policy change.** aragonite applies §6.9's leading-boundary
rule ("at the beginning of a line, after whitespace, or any of the delimiting characters `*`, `_`,
`~`, and `(`") to the email form; cmark-gfm applies it to the `www.` form alone. The family is
open-ended, not a list: every preceding character outside that set diverges (`a/xfoo@bar.com`,
`x)foo@bar.com`, `a:foo@bar.com` all stay literal here and link on GitHub), and the second-`@`
restart is downstream of the same choice (`foo@bar@example.com` links `bar@example.com` there and
nothing here; `a@b.c@d.e` links `b.c@d.e` there and `a@b.c` here). The module's stated authority is
spec prose where explicit, cmark-gfm where the prose runs out, and this clause is explicit and
blanket, so following it is the policy working. Revisit only if GitHub parity is chosen over spec
prose for this form.

**Half two — a real gap under that same policy.** cmark-gfm absorbs a `mailto:` or `xmpp:` prefix
into the address (`validate_protocol` in its rewind loop, byte-exact and lowercase-only, with
`auto_mailto = false`), so `mailto:foo@bar.com` links on GitHub with its prefix intact and the href
unduplicated. aragonite links nothing there: `:` is outside `EMAIL_LOCAL`, so the local-part walk
stops and the boundary check rejects. The spec's prose is silent on prefixes, which is precisely the
condition under which cmark settles the corner.

**Fix direction:** land half two with half one's decision. The `mailto:` half is a protocol-prefix
rewind; the `xmpp:` half is a second scheme with its own domain rule (cmark admits `/` in an xmpp
domain for the resource part) **and** a security-surface decision, since `xmpp` is not in
`ALLOWED_HREF_SCHEMES` and would otherwise render sanitized.

**Why deferred:** half one is a stated design choice with a documented authority, not a defect. Half
two is a new accept class that reaches the href allowlist, so it wants its own conformance pass
rather than a ride-along on a domain-scan fix.

### No keystroke ceiling holds under an installed inline rung

**Severity:** watch (the cost is now measured and small; what is missing is a gate, and a clean
control to gate against)
**Files:** `src/lib/core/inline/scan/index.ts` (the pre-switch prefix consultation, the
default-arm unreserved-rung consultation, and `needsScan`'s per-character probe),
`src/lib/e2e/tests/perf/typing-latency.perf.spec.ts` (the `rung-*` report rows),
`src/routes/test/plugins/+page.svelte` (no rung-only route exists, so no clean control does)

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
prefix rung on `!` — the one reserved trigger the bail probes on demand rather than always visits
(0.9.36) — flips the same switch, and carries a larger term with it: on `!` the probe **succeeds**
on ordinary prose, so a block holding a single exclamation mark loses the fast bail outright and
runs the full scan loop. That was already true of `:` and `$`; `!` is simply the most
prose-frequent trigger the ladder has opened, and the first consumer is about to install it. A
document with latex or emoji installed therefore runs a more expensive bail loop than the standing
ceilings measure, on every keystroke, not merely a denser trigger cost.

**Measured 2026-07-29, and the consultation half is closed.** The four rows this entry asked for
now exist as report-only rows in `typing-latency.perf.spec.ts` (`rung-*`), each loading its fixture
twice — on the plugins route with the rung installed, and on the rung-free editor route — at 100KB,
30 keystrokes, p50/p95:

| row                                     | rung p50 | rung-free p50 | rung p95 | rung-free p95 |
| --------------------------------------- | -------- | ------------- | -------- | ------------- |
| bracket-dense under footnotes           | 8.2 ms   | 2.7 ms        | 14.6 ms  | 6.9 ms        |
| colon-dense under emoji                 | 2.6 ms   | 2.3 ms        | 8.5 ms   | 2.8 ms        |
| dollar-dense under latex                | 2.6 ms   | 2.3 ms        | 3.6 ms   | 3.4 ms        |
| plain prose under an installed `:` rung | 2.3 ms   | 2.3 ms        | 2.7 ms   | 2.6 ms        |

The per-occurrence consultation is at or below measurement noise on a trigger-dense 100KB document,
and **the bail probe this entry called the blindest spot is not observable at all**: plain prose
under an installed unreserved rung types at the same p50 as the same bytes with an empty registry.
The entry's own prediction (sub-millisecond at real scale) holds, on the row built to falsify it.

The footnote row's excess is **not** a scanner cost: it is the second mechanism that fixture
deliberately carries, and it now has its own entry (§ "A mounted footnote reference makes every
keystroke O(document)"). Nothing in the numbers above is about it.

**Residual:** no keystroke CEILING under an installed rung. The rows report; nothing fails if the
number doubles. Gating was declined deliberately: a recognizer is the registering plugin's code, so
a ceiling here pins a number the editor does not own, and the only available control is confounded
(the plugins route installs eight base plugins, two of them whole-document derivers), so a route
delta bounds a rung's cost from above rather than measuring it. A clean per-rung ceiling wants a
rung-only harness route, which is the work this residual names.

**Why deferred:** the measured numbers say the consultation is not worth a ceiling. Re-open for a
rung-only route if a consumer reports keystroke latency under an installed rung.

### A mounted footnote reference makes every keystroke O(document)

**Severity:** watch (reachable in ordinary use, measured, unguarded; no field report yet)
**Files:** `src/lib/plugins/footnotes/FootnoteReference.svelte` (the `$derived` that reads the
content version), `src/lib/plugins/footnotes/footnote-numbering.ts` (`footnoteNumbersFor` — the
shared walk, which parses inline content per prose leaf), the editor's content-version derived (the
whole-tree touch it memoizes against), `src/lib/e2e/tests/perf/typing-latency.perf.spec.ts` (the
`rung-bracket-dense-footnotes` rows that measure it)

A mounted `[^label]` reference derives its number from the whole document, so while one is in the
viewport every keystroke anywhere pays a walk over every node plus an inline parse per prose leaf.
Windowing cannot bound it: the walk reads the CST, not the mounted set. Browser-measured 2026-07-29
by the rows above, typing into a bracket-dense document with references in view:

| document | keystroke p50 | rung-free control | mounted references |
| -------- | ------------- | ----------------- | ------------------ |
| 100KB    | 8.2 ms        | 2.7 ms            | 20                 |
| 1MB      | 50 ms         | 2.7 ms            | 20                 |

The mounted count is identical at both sizes while the document grows 10× and the cost grows ~6×,
with the control flat — so the growth is the walk, not the number of readers. `performance.md`'s
third non-viewport axis carries the mechanism; this entry carries the fact that nothing fails if the
number gets worse. With no reference mounted the version is a lazy derived that never computes and
the cost is zero, which is why the standing ceilings (no plugins installed) cannot see any of it.

This is already far cheaper than what it replaced — each mounted widget used to inline-parse the
whole document itself, 10–140× worse — so the shape is the concern, not a regression.

**Fix direction:** an **incremental content version** rather than a whole-tree touch, so an edit
invalidates the readers whose subtree changed instead of every reader on every keystroke. The read
set is deliberately wider than any one reader needs today (a metadata, trivia, or inner-affix write
invalidates every reader), which is what makes the incremental version the lever rather than a
narrower memo key.

**Trigger workload:** the **limestone integration**, which is the first consumer to run large
documents with footnotes under real typing. A 1MB note with one reference in view is 50 ms per
keystroke on the dev build.

**Why deferred:** the numbers are report-only by design (a baseline here is a decision to make from
evidence, not a diff to bless), and the lever is a change to the version seam that wants its own
pass rather than a ride-along on a measurement task. Re-open on a consumer keystroke-latency report
over a reference-bearing document, or on a decision to gate the axis.

### `selectionChange` fires on gestures that change no selection

**Severity:** watch (noise on the highest-traffic path; every payload is correct)
**Files:** `src/lib/selection/selection-state.svelte.ts` (`resetSelectAllCount` / `collapse` /
`clear` notify unconditionally), `src/lib/selection/shared-keydown.ts` (the per-keystroke reset),
`src/lib/selection/cross-block/pointer.ts` (`resetForPointerDown`)

Every mutator notifies whether or not it changed anything, and two of the highest-traffic entry
paths call one on every gesture: `handleSharedKeydown` resets the select-all counter on each
non-Ctrl+A keystroke, and `resetForPointerDown` does the same on each pointerdown. With the counter
already 0 — the common case — that is a `selectionChange` per keystroke reporting the selection the
subscriber already has. A collapse or clear on an already-collapsed selection does the same. The
native `selectionchange` bridge then re-emits the real caret move, so the settled value is never
wrong; a subscriber doing real work per event (a toolbar re-measuring rects, a host persisting)
pays for the duplicates.

**Fix direction:** notify only on an actual state transition (compare before/after in each mutator),
and/or drop a payload equal to the last emitted one at the `Editor.svelte` emission seam. Both are
cardinality changes on paths whose counts nothing currently pins.

**Why deferred:** found while building the batch seam that fixed the stale-restore emission, and
deliberately not bundled with it — no-op suppression takes a plain click with no prior cross-block
selection from one state-channel emission to zero, which is a behavior change on the busiest path
in the editor and wants its own red-first pins per entry path rather than a rider on a payload fix.

### A declined cross-block paste still leaves an undo entry behind

**Severity:** watch (one dead Ctrl+Z press, on a branch that needs two cross-block gestures to race)
**Files:** `src/lib/selection/cross-block/paste.ts` (`mutCtx.pushUndoSnapshot()` precedes the delete
that may resolve no caret)

A cross-block paste pushes its undo snapshot before the delete, so one snapshot covers the whole
delete-then-paste. When the delete resolves no caret — another cross-block mutation was in flight
and collapsed the selection while this paste waited it out, which the paste now reports on the
`error` channel — nothing was mutated under that snapshot, and the stack keeps an entry identical
to the state it restores. The next Ctrl+Z is a no-op; a second press then undoes the real edit.

**Fix direction:** the snapshot has to precede the delete (the delete commits with `undoEntry:
'join'`), so the fix is a discard rather than a reorder: the controller has no pop for a snapshot
whose commit never happened, and adding one is a change to the undo seam, not to this route.

**Why deferred:** found while giving the declined branch its error channel; the branch is rare
enough that the wasted entry has never been observed, and inventing a snapshot-discard API for one
caller would put a rollback door on the undo controller ahead of any second consumer for it.

### A dead-space click declines on surfaces that address something other than characters

**Severity:** minor (a click that does nothing, on a narrow set of surfaces)
**Files:** `src/lib/selection/dead-space-caret.ts` (the `foreignDragHitTest` and
`contenteditable="true"` gates in `createDeadSpaceCaret`'s `handleClick`)

A click in the editor's padding, or below the last block, places the caret at the nearest text.
Two families decline instead. A **table** carries `foreignDragHitTest` because its offset is a
row-major cell index, not a character position, so "the end of that line" names a cell and the
gesture has no unambiguous landing. A **non-editable leaf** (thematic break, a rendered diagram,
an image block) has no character position at all; declining is deliberate there rather than
handing the block the whole-block focus a click ON it means, which would arm the next Backspace
against a block the user only clicked near.

**Repro:** put a table last in the document and click below it; nothing the editor did happens
(the browser's own click handling still places a caret in the nearest cell, so the decline is
not separately visible).

**Why deferred:** the table case needs a decision, not code — either the table kind grows a
"nearest cell to this point" contract distinct from its drag hit test, or the gesture means
"caret at the end of the last cell" regardless of x. Both are table-cell caret work, and picking
one on the way past would set the precedent for every future kind with internal addressing. The
non-editable case is not deferred at all: declining is the answer.

## Virtual rendering

### Undo issued inside a paste's in-flight reveal lands the caret on restored content

**Severity:** watch (misplaced caret; never corruption)
**Files:** `src/lib/editor-actions/paste-coordinator.ts` (`landCaret`),
`src/lib/editor-actions/commit/history.ts` (undo's own `revealTarget`)

A structural paste's caret landing reveals its target after the commit resolves the tree, so
between those two moments a Ctrl+Z can restore the pre-paste snapshot while the reveal is still
scrolling. The reveal then focuses a path whose content is no longer what it was aimed at. Nothing
serializes the two: `beginCommit`/`endCommit` is a DEV bracket that closes before the tick, and
undo's restore issues an independent `revealPath`. Both writers also touch the scroller's
`scrollTop`.

The window is one tick plus a scroll, and no gate reproduces it — a Playwright key round-trip is
slower than the window, so there is no constructed repro to pin. The tree is never at risk: undo
restores from a snapshot captured synchronously before the mutation, so the document is correct
either way and only the caret's resting place is wrong.

**Fix direction:** if a repro ever appears, the move is to let the landing check that its commit is
still the newest entry before placing the caret — not to serialize commit resolution, which is a
far larger change than the symptom warrants. The reveal anchor's claim tokens are that shape one
layer up (a landing asks whether its premise still holds before acting), but they cannot be reused
here: undo's restore passes the MOUNT primitive, not `scrollTo`, precisely so a history swap does
not move the viewport, so it mints no claim and a paste's claim never learns an undo happened.
Closing this needs a monotonic stamp on the undo controller, not an anchor read.

**Why deferred:** introduced knowingly with the VR-12 fix (the alternative was keeping a caret that
is lost on every large paste), bounded to a caret position, and not constructible in a gate today.
Recorded so the next reader of `landCaret` knows the window is known rather than unnoticed.

### The reveal pin does not survive layout churn INSIDE the target's container

**Severity:** watch (a resolved nested target pushed out of view; no corruption, no strand within
the block)
**Files:** `src/lib/reactivity/list-windowing.svelte.ts` (`setChildSubtotal` is deliberately
correction-free), `src/lib/reactivity/use-container-windowing.svelte.ts` (the root scope is the only
anchor claimant)

The reveal anchor re-asserts its target on the root scope's own measure passes. A nested scope's
growth reports upward through `setChildSubtotal`, which is correction-free by design — a deep leaf
measurement must not cascade scrollTop fixes up the chain — so no `correctAnchor` runs and the pin
is never consulted. An image decoding INSIDE the container holding a revealed nested target
therefore pushes that target down by its full growth with nothing re-asserting it. Measured on a
tall blockquote: the target moved from 664 to 2064 while `scrollTop` stayed at 839 across two
ResizeObserver flushes.

Pre-existing, not a regression: the same construction fails identically before per-call claims and
the full-path pin, which closed the sibling case the ledger did name (churn BELOW the container,
now gated by `perf/vr-reveal-anchor`).

**Fix direction:** either let a nested scope's upward subtotal report run an anchor correction when
a reveal claim is live (narrow: the claim is the gate, so the no-cascade rule holds for every other
write), or let nested scopes claim the anchor for a target on their own path. The first is smaller
and does not reopen the one-scrollTop contention the single-claimant rule exists to prevent.

**Why deferred:** found while building the race e2e, on a shape no consumer has hit — it needs a
container taller than the viewport, a revealed target inside it, and content above that target
growing after the settle. The no-cascade rule it collides with is load-bearing for scroll stability
everywhere else, so the fix wants its own measured pass rather than a rider on the ownership one.

### Reveal scrolls a hidden ancestor that a drag deliberately will not

**Severity:** minor (two seams answer the same geometry question differently, on purpose)
**Files:** `src/lib/cursor/scroll-ancestors.ts` (`userScrollportFor` excludes `hidden`; the
clipping walk includes it)

A fixed-height `overflow: hidden` ancestor is script-scrollable: `scrollIntoView` moves it, and
reveal genuinely brings the block into view there — so `scrollTo` reporting `true` is honest. Drag
autoscroll declines the same box, by convention rather than capability: a user cannot wheel a
hidden box back, so a drag that scrolled it would strand content out of reach. It walks past it
instead, to whatever scrolls outside — an outer scroller, else the page — so the consequence is
narrow: a drag reaches an off-screen destination only as far as the boxes OUTSIDE the hidden one
can carry it, and where none of them scrolls, the reveal path is the only way in.

**Fix direction:** none wanted unless a real embedding asks. If it needs closing, the move is to
let a drag scroll a hidden box only while the pointer is held — the window in which the user can
still undo the strand — rather than widening the predicate.

**Why deferred:** a deliberate divergence, stated at the seam and in the consumer guide's host-CSS
contract. Recorded so the next reader of that predicate does not "fix" the asymmetry.

## Code structure

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

### The reveal fold is funnelled at the command dispatch, not at every mutation entry path

**Severity:** minor (no known reachable caller; the guard covers the arms most likely to grow)
**Files:** `src/lib/components/blocks/text/TextEditableBlock.svelte` (`runCommand` folds and
`performBlockCommand` asserts), `src/lib/components/blocks/editable-surface.ts` (the clipboard seam's
own fold), `src/lib/editor-actions/block-edit.ts` (the door a bypassing caller would reach)

A live inline reveal holds the block's bytes in ephemeral DOM, so any mutation must fold first. Two
seams do: the clipboard handlers and the block command dispatch, whose `command-during-reveal`
assertion (G1.26) fires on a `runCommand` branch that skips the fold. Neither reaches a caller that
goes straight to `blockEdit.splitBlock` / `updateBlockContent` on a revealed block — such a caller
sees no fold and no guard. That is the sibling-path-parity shape culture.md warns about, and the
prescribed rung where the funnel cannot be built is a source-scan lint under
`src/lib/test/invariants/lint/`.

**Why deferred:** the scan has no low-noise formulation yet. The block-edit door has many legitimate
direct callers that can never hold a reveal — container overrides, editable leaves, cross-block
dispatch, paste — so "every call routes through `runCommand`" is false by design, and a rule that
enumerates the exceptions decays into the list it was meant to replace. The likely growth case is
covered by construction instead: a new arm added to `blockCommand`'s switch inherits both the fold
and the guard without its author doing anything. Re-open if a mutation entry path is ever added to
a reveal-bearing surface outside that switch.

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

### `updateOwnMetadata` is not reading-gated, so "reading mode writes no bytes" is pinned by tests where a choke point is available

**Severity:** medium-low (published-contract enforcement gap; no shipped defect)
**Files:** `src/lib/editor-actions/plugin/container.ts` (`updateOwnMetadata` — no mode check),
`src/lib/editor-actions/block-edit.ts` and `editor-actions/nested/nested-block-edit.ts` (the
forwarding level), `src/lib/editor-actions/block-edit-core.ts` (`updateBlockMetadata` — the
choke point)

0.9.36 promoted "reading mode writes no bytes" from a v1 limitation to a **published contract**
(consumer guide, `plugin-contract.md`, changelog). The plugin-facing metadata door does not
enforce it: none of the three levels from `updateOwnMetadata` down to `updateBlockMetadata`
checks the mode, so a third-party container plugin following the documented recipe can commit
bytes in reading mode. Its immediate siblings inside the same factory DO gate —
`composeExpandDoor` declines in reading, and the whole-block edit branches check `isReading` —
so the container seam gates every path except the one plugins are told to use.

Reading-mode inertness is per-site everywhere: the task checkbox's comes from `if (readOnly)
return` in `ListItemBlock.toggleTask`, which is G4.19's arm 2. **G4.19 cannot see this path** —
it scans `dispatchKeyCommand`/`dispatchKindCommand`/`getCommand` construction sites, and a
component's `onclick` is not one. The bundled details disclosure is safe by construction (its
reading handler is closed over a module with no commit door in its dependencies, which is a
compile error to violate), and that construction is pinned: routing the reading path to the
committing handler reds 3 of 4 presentation specs on the byte/undo/mount triple. So the contract
is **test-pinned where a single guard at a choke point would make it structural** — the
enforcement ladder's `documented`+`guarded-per-site` rung where `unrepresentable` is reachable.

**Fix direction:** gate at `block-edit-core.updateBlockMetadata`, the one choke point every
metadata write funnels through, so the contract holds for every container plugin in one edit.

**Why deferred:** pre-existing, with no shipped defect behind it — the bundled containers all
gate, and the e2e pins hold the line for the one that matters. The fix is a choke-point design
decision (does the gate refuse silently, dev-warn, or return a result the caller must handle?)
that touches every container plugin's commit path, so it wants its own pass rather than a rider
on a records round.

### A table cell's inline widgets read neither the presentation mode nor the theme

**Severity:** nit (sibling-parity gap; benign today)
**Files:** `src/lib/components/blocks/table/cell-render.ts` (widget pool built without
`getPresentationMode`/`getTheme`; render key carries no mode term), against
`src/lib/components/blocks/text/text-render.ts` (carries both)

0.9.36 wrote _the theme rides exactly where the mode rides_ into `plugin-contract.md` and the
plugin guide. The cell render surface is the one sibling carrying neither term, so it preserves
that rule rather than half-answering it — but a published rule with an unrecorded exception is
the sibling-parity shape `docs/contributing/culture.md` says to record rather than pass.

Benign today: no bundled inline-widget **component** reads the mode (only block components do),
so a cell widget defaulting to `'source'`/`'dark'` changes nothing shipped. It becomes real for
the first mode- or theme-reading widget placed in a cell, which would otherwise discover it in
production.

**Fix direction:** thread both terms at once, and add a mode term to the cell's render key — a
mode flip must rebuild a cell's inline DOM the way it rebuilds a prose block's.

**Why deferred:** it belongs with whoever first ships a mode- or engine-painted in-cell widget;
adding the terms now would ship two unused getters plus a new render-key segment on the
keystroke path, unexercised by any consumer.

### A details body line reproducing `</details>` destroys the container, and no rebuild can repair it

**Severity:** important (container destruction on reload; guarded, not silent)
**Files:** `src/lib/plugins/details/details-kind.ts` (the opaque rebuild),
`src/lib/invariants/node-shape.ts` (G1.12, which now covers the directive/details tier),
`src/lib/test/plugins/details/terminator-collision.test.ts` (the floor pins)

`</details>` is a fixed terminator with no fence length to escalate, so a body line reproducing
it is unrepresentable: every byte sequence containing that literal line closes the element, in
aragonite and on GitHub alike. The 2026-07-25 escalation pass proved repair is not available at
the rebuild seam: escaping the child's bytes on the way out diverges the container's raw from
its live children, which is exactly the staleness G1.12 exists to fire on. The `:::` containers
got the fence-escalation fix; this kind structurally cannot.

**Guarded floor (pinned by five tests):** the collision is reachable through the real commit
path, bytes still round-trip, and G1.12 catches the live-tree-versus-reparse divergence, so the
dev channel and the e2e invariant watcher see it rather than the document corrupting silently.
On reload the container is gone and its tail re-parses as siblings.

**Fix direction:** a commit-path escape seam: the kind translates the offending body edit at
commit time (escape or transform the typed `</details>` before bytes land), the same seam the
opaque-write / kind-aware replace work needs. Decide the byte policy there, not in `rebuildRaw`.

**Why deferred:** the rebuild-side fix is proven impossible, the commit-path seam is a design
pass shared with the post-1.0 opaque-write work, and the floor is honest (loud in dev, byte
round-trip intact).

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

### A copy endpoint inside a container's body loses that container's wrapper

**Severity:** minor (clipboard fidelity; the container's kind flattens to prose on paste)
**Files:** `src/lib/selection/clipboard-text.ts` (`collectCrossBlockText`)

The collection walk skips endpoint ancestors, so a container holding an endpoint never emits its
own syntax. Four seams recover the shapes that matter: `promoteToContainer` (an endpoint at a
full boundary takes the whole container), `soleChildContainerPrefix` (a strip container's sole
child keeps its per-line marker), and the reserved-chrome pair (an END mid-chrome synthesizes a
chrome-only container; a START mid-chrome reopens the container around the collected body and
closes it where the walk leaves its subtree). Everything outside those four loses the wrapper,
and the gap starts at depth 1, not at nesting. Measured repros:

```
> A          start mid-"A", end in "Below"  →  "\n\nB\n\nBel"          two bare paragraphs
>
> B          two children: the sole-child marker seam declines

> Line one   start mid-"Line one", end in "Below"  →  "ne one\nLine two\n\nBel"
> Line two   sole child, but multi-line: the seam's suffix arithmetic
             (parent.raw.endsWith(leafRaw)) fails, since the child's raw
             carries no ">" and the parent's carries one per line
```

Nested containers are the same defect one level down: in `::::note Outer` holding
`:::note Inner`, a copy from mid-`Outer`-title to mid-`I1` collects the inner's chrome and body
bytes flat, so the inner reparses as prose inside the (correctly re-emitted) outer.

**Fix direction:** generalize the chrome-start wrapper into endpoint-ancestor reconstruction.
Every container strictly between the LCA and an endpoint re-emits its own wrapper (opener plus
closer for `opaque`, per-line prefix for `strip`) around the fragment it holds, innermost first,
so nesting depth stops being the thing that decides whether structure survives a copy.

**Why deferred:** not rarity, cost. Reconstructing every endpoint ancestor changes the bytes a
copy produces for shapes that ship today (a partial blockquote, a partial list item, any
multi-child container), so it moves existing byte expectations across the clipboard suites rather
than adding to them. Fold it into the post-1.0 clipboard/hook generalization, where those
expectations are being revisited anyway.

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

### An image that has not loaded reserves no space

**Severity:** nit (visual; an unloaded image occupies 0×0 instead of reserving space)
**Files:** `src/lib/components/image/widget-dom.ts` (adds `md-image-placeholder` /
`md-image-blocked`, and leaves an in-flight widget classless), `src/lib/styles/editor.css`
(styles neither class)

`.md-image-widget` shrink-wraps its `<img>`, and an `<img>` with no decoded dimensions lays out
0×0 — so every state short of "loaded or known-broken" is a zero-height widget. Three ways in,
one class:

- `imageLoadPolicy: 'placeholder'` and a disallowed `src` scheme both leave `img.src` unset and
  mark the widget with a class that has no CSS anywhere.
- an **in-flight** request carries no state class at all, so there is nothing for CSS to hang a
  treatment on. Measured with an intercepted, held request: `md-image-widget`, `complete=false`,
  `naturalWidth=0`, box 0×0 until it settles, then 229×60.

`md-image-broken` is the one styled member of the family and the shape a fix would copy.

**Why deferred:** what an unloaded image should look like is a visual-design decision (reserve
the declared `|WxH` box? a click-to-load affordance for the deferred policy? distinct treatments
for blocked, deferred, and merely-slow?), not a defect with one right answer. The in-flight case
is also the one every browser shares for a dimensionless `<img>`, so a fix here is aspect-ratio
reservation, not a bug fix.

### `BlockComponent.focus(offset)` parks a caret without ending a live cross-block range

**Severity:** important (public-contract footgun; the fix is breaking) · **Target: the 1.0 freeze decision**
**Files:** `src/lib/block-component.ts` (the public export), `src/lib/components/blocks/editable-surface.ts` (the park primitive)

`focus(offset)` is one verb with two meanings: the extend paths need park-without-clearing (seating a
clear there reds three real behaviors — measured, not assumed), while every user-facing caret
placement must end a live range or the next keystroke type-replaces the document (two such data
losses were found and fixed in 0.9.36's manual wave). The door is documented as a park primitive
naming `setSelection` as the range-ending door, both halves pinned (`public-caret-doors.spec.ts`),
and G2.12 fails new pointer gestures at birth. The proper fix — splitting `focus` into two verbs —
is a breaking change on the frozen public contract and must be on the table at the 1.0 freeze,
not after it.
