# Changelog

Editor version history (CST block editor). **Style:** one tight entry per released version, newest first; the current major lives in this file, and when a major closes its entries roll into `docs/changelog/<era>.md`. **Product changes only:** behavior, API, plugins; never repo meta-work (conventions, comment or docs hygiene, tooling, process).

### 0.9.36 (unreleased)

- **Typing `</details>` inside a `<details>` no longer destroys it.** The terminator is a fixed
  token with no fence length to escalate, so the `:::` containers' escalation fix was unavailable
  and the container silently stopped containing its own body on reload. A container kind can now
  declare `bodyWrite` — a rule making text legal as a CHILD's raw, the ancestor-side counterpart of
  `normalizeRawWrite` — and the tree-op write sinks apply it to bytes destined for the body. Details
  escapes the offending line's `<` to `&lt;`, which reads as the literal tag in the editor and on
  GitHub alike while closing neither. The placement is what makes it work where the rebuild seam
  could not: escaping ahead of the reparse means the kind a write lands on is the kind its committed
  bytes describe, and the container's raw never disagrees with its children. The rule asks the
  GRAMMAR rather than the container's own spelling: what closes the element in a browser is
  everything CommonMark hands to raw-HTML passthrough, so ` </details>`, `</DETAILS>`, `<details >`
  and the still-unterminated `</details` are escaped too — each of those reloads intact locally
  while silently ending the element on GitHub. Plugin authors reach the same predicate through
  `htmlBlockTagLineMatcher`. Both caret doors read the rule's exact image, so a rewrite never
  strands the caret. Typing, split, cross-block typing and both delete arms go through the rule —
  a range delete normalizes the raw it MERGES, since a join can mint a terminator line out of two
  lines that each held one harmlessly mid-line. Paste and block move do not yet, and keep the
  ledger entry. The requirement is structural rather than remembered: the byte sinks take a parent
  that has ANSWERED which container owns it, so a sink added later cannot inherit the gap silently.

- **Plugin/testing surface: the container conformance kit's `terminatorCollision` cell writes
  through `bodyWrite`.** The cell's fixture `bodyRaw` now names the bytes a USER produces rather
  than the bytes that reach the tree, so a container answers for the repair it actually ships —
  escaping at the sink, or growing its own fence at rebuild. A kind declaring no rule writes
  verbatim exactly as before, so existing profiles are unaffected; the details profile flips from
  `exempt` to `asserted`.

- **Plugin surface: augmenting a container carries every group field.** `augmentBlockKind` merged
  the container group through a hand-kept field list, so a group field the list had not caught up
  with was silently dropped — the augment succeeded and the descriptor kept its old value. The merge
  now reads the group generically.

- **Enter separates, so what you split stays split on reload.** Splitting a paragraph left the two
  halves joined by a single newline, which GFM lazy continuation folds back into one paragraph — the
  session showed two blocks and the saved file held one. The split now gives the second half a
  blank-line separator whenever the first half would absorb a following prose line. That question is
  asked of the parser, not of a kind list, so a heading, thematic break or setext heading (each closed
  by its own line) still joins tightly and a kind registered later is covered the day it registers. It
  reaches every split: top level, inside a blockquote or a list item, and inside a footnote definition,
  because each container's raw rebuild already re-prefixes a blank line correctly. Two capture
  sessions of the note simulation had been failing the parse-convergence oracle on exactly this and now
  pass. Three producers of the same divergence remain, all of them mutations that invalidate a tight
  join instead of minting one (a kind demotion, a delete between two paragraphs, a reorder); they keep
  the ledger entry.

- **Behavior change: a trailing backslash then Enter is now two paragraphs, not a hard break.** Enter
  splits everywhere else in the editor, and it separates now, so it can no longer leave a soft join
  behind. `Shift+Enter` (`block.hardBreak`) is the gesture that authors a hard break: it inserts the
  backslash and the line ending together. Press it BETWEEN the two halves, with both already typed —
  at the end of a paragraph the inserted ending becomes the block's own, so it leaves a trailing
  backslash and the caret stays on that line until a following line exists.

- **Breaking, plugin surface: a container block publishes ONE instance export.** `export
{ containerApi }` replaces the twelve `export const` forwards plus the `satisfies` completeness
  block every container carried, roughly fourteen lines down to one, and BlockHost resolves the two
  publication shapes (a leaf's own surface, a container's `containerApi`) at the single point it
  stores a ref. Every consumer of that ref reads the resolved surface: `publishRefSlot` into the
  parent's `innerBlockRefs`, both overlays, the focus/reveal/caret-at-point walks. Eleven containers
  migrated (four built-ins, four bundled plugins, the harness callout, the consumer example's callout
  and dev-guard probe); a container that forgets the export, or publishes a leaf-grade one, now fails
  `npm run check` at the call that registers its component, because the registry types a block's
  exports as exactly those two shapes and the container arm requires the descent verbs. That type is
  the rung the retired per-member forwards were reaching for, and it reaches further: the old
  `satisfies` guard covered a member dropped from a hand-written forward block, while this covers any
  container an author registers, hand-rolled surfaces included.

  Two latent defects fell out of the migration. `SelectionOverlay` decided who paints a container's
  selection rects by testing whether the ref carried `measurePartialRects` at all, which discriminated
  only because a strip container happened not to forward that member; once every container publishes
  the shim's whole surface it stopped discriminating, and a blockquote or list inside a cross-block
  range would have washed its own box on top of its children's rects. The decision now keys on the
  declared fact it always meant, and it is made ONCE, at BlockHost, and handed to both overlays,
  which had been holding the same conjunction character-for-character — the drift that let the two
  disagree in the first place. Its child-hosts term was also wrong for a grid, whose rows render
  inside its own component rather than through BlockHost: it answered true off child COUNT, and only
  the presence test above kept the table painting. The pre-existing e2e specs owned both cases end to
  end (`selection/overlay`, `plugins/mermaid-selection-overlay`, three table selection specs, against
  a written requirement), and reproduce both under mutation; what is new is a jsdom routing suite that
  contrasts container, leaf and grid under one live range in seconds rather than in a browser project.
  The G2.12 lint moved with the migration rather than losing coverage: its park-forward
  pairing arm is leaf-scoped now, and a new arm requires every container-seam call site to publish
  `containerApi` (the export keyword included), which is what still covers `listItem`, the one
  container with no component-registry entry to type-check. It found an eleventh container the
  issue's own enumeration had missed.

- **The table's keyboard vocabulary is declarative, so `keybindings` reaches it.** The table's
  eleven structural chords lived in a second, hard-coded dispatch — an ordered `SHORTCUTS` table
  inside the cell's keydown plan — which ran BEFORE the keymap. So an override for one of them was
  resolved and then never consulted, and the consumer guide had to carve the whole Tables family
  out of its rebindability promise. They are `tableCell` keymap bindings now, on eleven new
  `table.*` command ids, and the guide's promise covers them: a disable frees the chord, a rebind
  moves it, and a global-scope disable reaches a cell like any other surface. Additive to the
  plugin surface — new command ids and one new descriptor capability, with `KeyBinding` itself
  unchanged — so no migration.

  The precedence the retired table carried is now the CALL ORDER in one function: the command
  dispatcher gets first refusal on every chord, and what reaches the navigation plan is a chord no
  binding claimed. That ordering is forced rather than chosen — the shared prose keydown prelude's
  own `ArrowLeft`-at-offset-0 boundary hop does not gate on Alt, so anything resolving the keymap
  after it would lose `Alt+←` (move column) at a cell's left edge, which is exactly the collision
  the SHORTCUTS ordering existed to prevent. The plan's branches therefore still ignore Alt and
  Mod, deliberately: an unclaimed modified arrow (a disabled binding, or reading mode, where the
  whole vocabulary dead-keys) is just an arrow and must navigate, where answering "native" would
  hand it to that prelude, whose boundary branches move focus among a block's siblings by index —
  inside a cell, the wrong axis entirely. Reading mode's refusal gains an owner it did not have:
  the structural chords are now dead-keyed by the command seam's own gate, leaving the cell only
  the guard the seam cannot supply, for the row-appending end of Tab/Enter.

  Two things stay off the keymap, and the boundary is the same one in both cases: arrow navigation
  between cells and the three-stage `Mod+A` read where the caret sits INSIDE the cell, which a chord
  cannot express. Neither is a command, which makes the two override directions asymmetric, and the
  guide now says so: a DISABLE cannot reach them (there is no binding to unbind), while a BIND
  shadows them completely, because the dispatcher resolves first. The intended precedence — an
  explicit binding wins — but worth stating, since claiming an arrow takes the built-in gesture with
  it. Two smaller consequences of the same reordering: a plugin-GLOBAL chord now reaches a cell where
  the plan used to swallow it (the tier is documented to resolve last, and it does — it just gets
  there now), and in reading mode a modified structural chord falls through the dead-keyed seam to
  the navigation plan, so `Mod+Enter` hops a row where the retired route swallowed it. Navigation is
  what reading mode permits, so the refusal's scope narrowed only for keys that no longer mutate.

  The one keymap-design item routed to the freeze review is narrower than it first looked. The
  three-stage machine recognises "the chord that continues my run" against a chord LITERAL, which is
  a latent coupling rather than a live defect: select-all is not in the command vocabulary at all
  (the document-level machine keys off the raw key too), so there is nothing to rebind and no command
  to resolve a chord to. It bites only if select-all becomes a command id — which is exactly what
  1.2's unified command registry plans — and at that point the fix is a `chordsForCommand(kind,
command, overrides)` read over the tiers the resolvers already hold, not a new tier. Recorded so
  that migration inherits the coupling rather than discovering it.

- **A table can be reordered from the keyboard.** Every other kind moves among its siblings on
  `Alt+↑`/`Alt+↓`, which its drag handle's tooltip promises — but inside a cell that chord already
  means "move this row", and a table has no non-cell focus surface, so the block-level move had no
  gesture at all. It takes `Mod+Alt+↑`/`Mod+Alt+↓`: the same gesture with the platform modifier
  added, so the two reorders read as one family rather than two conventions. No new command and no
  new tree operation — the reorder walk already resolves the unit at the nearest ancestor that
  reorders its children, and a table's grid rows are not that, so a cell's own path lands on the
  table's slot, and the move announces itself to a screen reader through the same shared action
  every other kind uses.

  One caveat for anyone shipping this chord: `Ctrl+Alt+Arrow` is the display-rotation hotkey on some
  Windows graphics drivers, and `Cmd+Opt+←/→` switches tabs in some macOS browsers (the vertical
  pair this uses is free there). The chord routes through the keymap like every other table binding,
  so a host that collides rebinds it through `keybindings` rather than losing the gesture.

- **A destructive key at a mid-cell `<br>` edge deletes it, on the first press.** A cell paints no
  widget-selection overlay, so the prose select-then-delete model a `<br>` inherited showed the
  user nothing: press #1 moved the caret across the widget without deleting a byte, and press #2 —
  the caret now past it — deleted a NON-adjacent one two positions from where the user pressed. The
  fix is a surface-level policy substitution rather than a second delete path: a caret-edge policy
  names an AFFORDANCE, and a surface that paints none has to answer differently instead of
  degrading, so the cell declares `deleteGranularity: 'atomic'` for the widgets it paints and the
  one existing atomic arm does the work — one commit, undo anchored at the pre-delete caret,
  nothing duplicated. `onEdge` stays unset, so an arrow still steps the caret over the widget: that
  pair is the fix, and a policy that deleted on arrows too would pass any test written for the
  destructive half alone. Scoped to what the cell actually paints, because the classifier is
  kind-based and DOM-blind: an image renders as its literal source in a cell, so its edge is
  ordinary text and keeps the registered policy — otherwise one press would have eaten all of
  `![a](b)` where the user sees characters.

- **A dead-space click near a table lands in the nearest cell.** Clicking the editor's padding or
  the area below the last block places a caret at the nearest text — except on a kind that
  addresses its own internals, where "the end of that line" named a cell rather than a character
  and the gesture declined. Kinds now opt in with a descriptor capability
  (`caretTargetAtPoint`) that maps a point to an internal child path plus an offset, and the
  landing goes through `focusByPath`, so it inherits the range-ending caret door rather than
  minting a second one. It is a SEPARATE declaration from the drag hit test the same kinds carry,
  because the two answer opposite questions: a drag needs the exact hit and must decline off-cell,
  or a pointer crossing a grip gutter would jump the selection; a caret gesture arrives with its
  point already clamped into the block's box and must be total, so the table's implementation is
  one nearest-cell-box scan that answers in the gutter, in a padding gap, and in a windowing
  spacer band alike. y picks the row, x picks the column, and the end-of-document gesture keeps
  aiming at the box's trailing corner, which is how "below the table" reaches the last row's last
  cell. A non-editable leaf (a rule, a rendered diagram) still declines, and that stays the
  answer rather than a gap: it holds no character position, and the whole-block focus a click ON
  it means would arm the next Backspace against a block the user only clicked near.

  The decline was hiding a data loss, which is the part worth reading twice. The ledger recorded
  this as invisible, on the grounds that the browser's own click handling reaches the same cell
  anyway — and beside a block it does. What it does not do is end the editor's overlay-painted
  cross-block range, which only the claimed path clears: with a range live, a click beside a table
  left it painted over the caret the browser had just placed, and the next printable key
  type-replaced the whole document. So the regression test drives that gesture with a range live
  rather than from a clean caret, because that is the only way the editor's answer is
  distinguishable from the browser's — and the assertion that reds is "the document is still
  there".

- **Breaking, plugin surface: `BlockComponent.focus` ends a live cross-block range; the park
  behavior moves to `parkCaret`.** One verb carried two meanings — the selection-extend paths need
  a caret parked WITHOUT ending the range they are still growing, while every other placement must
  end it or the next keystroke type-replaces the document. Two whole-document data losses were the
  cost of that ambiguity, both pointer gestures that placed a caret and left the range painted.
  Migration is one line per block: forward `parkCaret` beside `focus` from whichever factory
  surface you already re-export (`containerApi`, the `createEditableLeaf` return, the shared
  editable surface). `focus` keeps its name and signature and is now the safe default, so a caller
  that does nothing inherits the range-ending; `parkCaret` is optional on the contract, and a block
  that omits it costs an extend nothing but the parked caret, since focus falls to the editor root
  whose listener routes the next cross-block keystroke anyway. Every implementation mints `focus`
  from one door (`placeCaret` over its own park primitive) so the range-ending is batched with the
  landing — unbatched, the `selectionChange` it fires would report the caret the landing is about
  to move. The single migrated caller is the cross-block dispatcher's `revealActiveEndpoint`, and
  the three extend behaviors that redded when the clear was seated in one verb —
  `extend-offwindow-endpoint`, `keyboard/vertical-skip`,
  `cross-block-delete-container-survivor-caret` — now ride the park verb and stay green. G2.12 is
  reworked around what is left un-funnelable: NATIVE caret placement (a click's own default moves
  the caret with no call to sit in front of), the park verb's caller allowlist, and the park verb's
  presence on every block forwarding a shared caret seam — the third arm found four blocks whose
  first-pass forward was missed, which is precisely the silent degradation an optional member
  invites. Taken pre-freeze deliberately: after 1.0 the same split costs an ecosystem migration.

- **What an installed inline rung costs, measured instead of assumed.** Every standing perf
  ceiling measures an EMPTY inline registry, because the harness route installs no plugins, so no
  row had ever seen the consultation a registered rung adds. Four report-only rows now load a
  trigger-dense fixture twice, once with the rung installed and once on the rung-free route:
  bracket-dense under footnotes, colon-dense under emoji, dollar-dense under latex, and plain prose
  under an installed unreserved rung. The last was the one the ledger called the gate's blindest
  spot, on the theory that registering `:` turns on a per-character probe for the whole document,
  and it is not observable: 2.3 ms p50 either way at 100KB. The trigger-dense rows are at or below
  noise too. What the rows did surface is the mechanism the footnote fixture carries alongside the
  consultation, and it is not a scanner cost: with a reference widget in the viewport the keystroke
  is O(document), 8.2 ms at 100KB against 50 ms at 1MB while the control stays flat at 2.7 ms and
  the mounted widget count does not change. The rows report rather than gate on purpose — a
  recognizer is the registering plugin's code, so a ceiling would pin a number the editor does not
  own, and the plugins route installs eight base plugins, so a route delta bounds a rung's cost
  from above rather than measuring it. Each row records its mounted-widget count, so a row whose
  plugin stopped installing fails instead of quietly reporting the control number.

- **The requirement↔spec lockstep is a rule again, not a review habit.** `testing.md` makes the
  filesystem the authoritative list of what the e2e suite covers, and every mapping in it was
  hand-verified at review time, which fails silently the day someone adds a spec without its
  scenario list. A source scan (G4.23) now pins the pairing in both directions, plus the stem
  collision the `.perf` strip would otherwise hide, plus per-file shape, and it found two specs
  whose requirement file was never written, one of them naming the missing file in its own header.
  The interesting half is the count rule: scenario-count equality was measured and refuted (most pairs
  diverge legitimately, because one test routinely walks several bullets), so the shipped
  rule fires only on a requirement list that ran 3× ahead of its spec, and every deliberate
  divergence carries a reason string. An equality rule would have needed a per-pair allowlist for two thirds of the suite and
  would have pressured authors toward padding the suite with one-assertion tests, which is exactly
  why the guard sat deferred. Its live divergences are one seeded-simulation family plus a handful of
  named compound tests; the allowlist only shrinks, since an entry that stops diverging is reported
  as stale.

- **Reading mode's line is bytes, not interactivity.** The standing product question was whether
  reading mode should permit a curated set of edits (a live task checkbox, GitHub-style). The
  answer is no — the mode writes no bytes, and that is now a contract rather than a v1
  limitation. What the question was really about is a reader who cannot open a collapsed
  `<details>` to read it, and that need never required an edit: the disclosure now flips VIEW
  state there. The source stays byte-identical, no `edit` event fires, nothing reaches the undo
  stack, and the flip is dropped on leaving the mode, where the document's own `open` is the only
  truth again. A task checkbox stays inert precisely because toggling one WOULD rewrite the
  document — the line is what an affordance writes, not whether it responds. Two halves make it
  real rather than cosmetic: the reading handler is closed over a module with no commit door in
  its dependencies, so that path cannot commit rather than declining to; and the EFFECTIVE state
  feeds the container's collapse dep, so a transiently-opened section genuinely mounts and
  measures its body instead of painting an open caret over an unmounted subtree. The collapse
  cross-check gains its one carve-out, scoped to reading alone, since that is the only mode where
  a view running ahead of the document is legitimate.

- **The theme reaches content the editor does not style.** A stylesheet rethemes everything the
  editor paints, which is why the theme had no seam beyond CSS — but an engine that emits markup
  carrying color literals is outside that reach: a drawn Mermaid SVG cannot be rethemed, only
  redrawn. The theme now rides the four doors the presentation mode already rode (the container
  and leaf factories, the inline-widget props, `EditorContext`, plus a `themeChange` event), so
  "the theme rides exactly where the mode rides" is one statable rule rather than four
  half-answers. Mermaid consumes it end to end: the injected renderer takes a theme term, the
  render memo keys `theme\0code` — so a flip misses and a flip BACK is still a hit, where a
  cache reset would have thrown away work the user is about to ask for again — and the block
  reads the theme inside its render effect, which is the half that makes every mounted diagram
  redraw rather than just the next one to change. The engine adapter re-initializes per theme
  and serializes its renders, because mermaid's config is process-global and v11's `render`
  takes none: a `%%{init}%%` prepend would have avoided the global write and corrupted every
  diagram carrying YAML front matter, which must start at byte 0.

- **A load is not proof an image loaded.** The broken-image placeholder was decided by two
  predicates that disagreed: the build-time probe called a finished-but-unsized request broken,
  while the `load` listener could only ever CLEAR the class. So a response that resolves as
  success with no intrinsic size (measured: a zero-dimension SVG loads with `naturalWidth` 0,
  where a dead URL errors in ~60ms) rendered a 0×0 widget with no placeholder at all — until an
  unrelated rebuild ran the build-time probe against it, which is why a mode round-trip "fixed"
  it and the placeholder then stuck. One predicate now serves both sites, and the failed-URL
  memo is written wherever the state is decided rather than only on the error path. The reported
  shape was "a failed load is never redecorated"; the error listener was in fact synchronous and
  already pinned, so the fix is the arm nobody had looked at.

- **`--color-ui-faint` responds to the mode.** The hover veil on the table action menu shipped
  blue among neutral siblings and with one value for both palettes — a token satisfying the
  both-themes guarantee by declaring itself twice. It is now a neutral veil that flips polarity
  with the mode, and the manifest lint compares VALUES, so declaring a themed token twice with
  the same value no longer passes: it either differs per mode or is recorded as deliberate.

- **A reveal HOLDING the scroll position is its only writer.** The reveal anchor re-asserts an
  ABSOLUTE position derived from the list's live offset within the scroll content, which already
  includes the header slot's current height; the slot's own resize observer adds a RELATIVE delta.
  Each is right on its own and they produce the same number — but for one resize, in that order,
  the delta lands on a position that already accounted for it and the revealed block sits a header
  height off. What kept this from surfacing is why it needed its own pass: the wrong write shifts
  the scroll, that shift mounts a block, and the mount's measure pass re-asserts the anchor, which
  puts it back — so the landing is usually correct and the defect was invisible to every arm that
  measured where the target came to rest. It is invisible, not absent: the corrector runs only when
  the slide happens to mount something. The observer now ASKS whether the anchor is holding the
  position and skips its delta when it is. Asking, not re-placing, is the load-bearing half: a
  `'nearest'` reveal of a block that was already in view scrolls nothing and still holds its claim,
  so a writer that deferred by re-placing would drag that reader to the top pin on a resize they
  only wanted compensated — which windowing hides, since a windowed document re-asserts on every
  measure pass and the target is already at the pin. The regression arms watch the writes rather
  than the resting place: once one write has put the target where the reveal asked, no later write
  may take it away, and a claim the anchor is not holding still gets its compensation.

- **A drag reaching the edge of the screen scrolls the page.** The autoscroll edge math compares
  the pointer against a scrollport's rect, and asked "what scrolls this editor" through a walk
  that answered `null` when nothing above the editor did — which every caller spelled as an empty
  target list. In the host embedding whose page owns the scroll, that meant a block drag toward an
  off-screen destination scrolled nothing at all, on any of the four drags (block reorder,
  cross-block select, table row, table column). The walk now answers the window instead of
  nothing, so the case is unrepresentable rather than merely handled. The window is not
  substitutable by an element: `document.scrollingElement`'s rect is the whole document box, so
  feeding it to the edge math puts the bottom edge thousands of pixels below the screen and the
  pointer never reaches it. The rect comes from the viewport and the write goes to the scrolling
  element — two halves of one answer, from different places on purpose.

- **A host-mode editor gets native scroll anchoring back.** The root turns `overflow-anchor` off
  because windowing corrects the scroll by hand (VR-2), and that opt-out excludes the editor's
  whole subtree from the HOST's anchor candidates too. In host mode windowing never activates, so
  neither mechanism held the line: with a page-scrolled journal shell scrolled deep into an entry,
  the viewport contains nothing but editor content, the host has no anchor to pick, and an image
  decoding in above the fold slid the reader ten blocks down the document — its whole height. The
  fix is one declaration scoped to the mode, but the reason it took a task rather than a line is
  the oracle: the pin available before this observed the computed style, i.e. that the declaration
  parsed, which is not evidence that anchoring behaved. It now ships with an e2e that watches the
  reader's own top block across the decode, on a new page-scrolled harness route, with a control
  arm growing the identical image one box further out — so a red says the editor lost its anchor
  rather than that the page never had one.

- **Breaking, plugin surface: an inline rung that claims past its scan range now throws at the
  dispatch.** The scanner already refused a claim that started somewhere other than the cursor or
  failed to advance; it never checked the far end. A block's scan range is not always its raw — a
  heading's content range excludes the closing `#` run, a table cell's excludes the `|` — so a
  recognizer written against the string rather than the `end` it is handed claims bytes the block
  still needs, and the overrun left no trace at all: the node was appended, the cursor jumped past
  the range, and the scan loop exited as if it had finished. Nothing moved in the document; every
  caret offset after the claim was simply wrong, and the widget's `data-source-*` span covered
  markup the widget did not stand for. Semantics are half-open exactly as documented, so a claim
  ending AT the range end is the ordinary full-range case and only one running past it is a fault;
  the check is top-level only, since descendants sit inside the claimed range by construction. The
  break is the point, in the shape of the opener `consumed` change above: a third-party rung
  shipping this bug today fails loudly at first render instead of corrupting caret arithmetic
  silently, and the fix is to bound the terminator search by `end`. Taken pre-freeze for the same
  reason — after 1.0 the same change costs an ecosystem migration. Every bundled rung and the
  in-repo wiki test rung were checked against every sub-range of their own fixtures before this
  landed; none trips it. The conformance kit's range cuts stay: they name the failure as a cell
  against an author's own fixture at test time, where the dispatch throws at first render.

- **Testing surface: `runInlineKindConformance` — the battery a registered inline rung is held
  to.** Block kinds have had an executable closure matrix and containers their own kit; inline
  rungs, where the limestone integration's defect density concentrated, had nothing. The kit drives
  the seven things a rung can break without moving a byte: what it claims over the author's own
  fixtures, that its claims tile the scan range the block offered rather than reading past it, that
  it declines the grammar overlap its prefix shadows, that its widget is one atomic self-delimiting
  unit whose island the caret walk measures as its source span, that its editing declaration is in
  the vocabulary the caret-edge dispatch reads, that a rung minting a built-in kind carries the
  `rewriteImage` hook and can reproduce its own input, and that the rung is registered where the
  profile says it is. Every bundled rung is enrolled — footnotes' `[^`, emoji and the directive
  text tier sharing `:`, inline math's `$`. The overlap cell is the one most authors have not
  considered and is required rather than optional, on the `terminatorCollision` precedent: a rung
  consulted ahead of a built-in case claims those bytes whether or not they spell something the
  built-in owns, and a document that swallows `![[a]](u)` round-trips perfectly as a wiki embed
  nobody wrote. A rung on a reserved trigger may not excuse it at all. Two rules keep the kit from
  going hollow where an optional field would let it: fixtures are required and one the rung does
  not claim fails enrollment instead of skipping it, and an excuse the kit can falsify it
  falsifies — declaring the image-claim cell exempt while a fixture mints a stamped built-in is a
  failure, not a waiver. The tiling half is worth its own sentence, because
  `serialize(parse(source))` is raw-driven and cannot observe an inline rung at all: the property
  that IS a rung's to break is the scanner's, that its nodes tile the range with no gap or overlap.
  A block's scan range is not always its raw, so the kit also drives every fixture over a RESTRICTED
  range with the author's own grammar past `end`, cut once at the fixture's end and once just past
  an opener whose closer lies beyond it. The dispatch guard above is what refuses the resulting
  overrun; what these drives buy is when an author hears about it — against their own fixture, under
  a named cell, rather than at first render of a heading in somebody's app. A cell whose mechanism was out of headless reach
  reports `boundary` rather than a pass: without a DOM, and for a `component` kind whose island the
  editor mints rather than the plugin, the island contract genuinely did not run and the report
  says so.

- **A plugin that takes `:` first no longer kills the inline directive tier.** Directive
  activation latched its four steps on four different probes, and the inline recognizer's asked
  whether anything was registered on `:` rather than whether this activation had already run. `:`
  is a shared trigger — emoji rides it on its own rung — so installing `emojiPlugin()` ahead of any
  plugin that activates directives (`admonitionsPlugin()` does) answered yes for somebody else and
  skipped the recognizer, leaving `directiveText` declared and its widget registered with nothing
  to recognize: `:name[label]` stayed literal prose. Invisible to byte round-trip, which is what
  kept it in for a release — the bytes are unchanged either way, the tier simply is not there. Every
  step now guards on something the directive tier itself owns; the inline one, having no
  registration of its own to probe, borrows the `directiveText` kind's latch, sampled before the
  step that declares it. The rule the fix generalizes: guard on your own identity, never on a
  shared resource somebody else may be holding.

- **Breaking, plugin surface: a block opener returns a consumed-lines count, not a resume
  index.** `tryOpen` now returns `{ node, consumed }` where `consumed` is the number of lines the
  opener claimed starting at `ctx.index`, and the parser advances by that delta; the shape is named
  and exported as `BlockOpenerResult`, so an author no longer hand-inlines it. Migration is one line
  per opener: `{ node, nextIndex: ctx.index + 1 }` becomes `{ node, consumed: 1 }`. The point is
  what the type can no longer express: an absolute index could name any position, including
  `ctx.index` itself, which is the return that hung a tab on document load until the parse loop
  learned to decline it. That runtime decline is unchanged here; what is new is that the shape no
  longer offers an easy way to write the bad return. A count carries no origin to get wrong, and the
  six single-line built-in and bundled openers now say `consumed: 1` with no reference to the cursor
  at all. The `consumed < 1` case keeps its existing semantics exactly: declined in every build,
  dev-warned by `invariant:opener-advance`. Taken pre-freeze deliberately, since the same change
  costs an ecosystem migration after 1.0. Scanners are unaffected and still hand back positions:
  `blockquoteExtent` returns a `nextIndex` its callers slice with.

- **Breaking, testing surface: `ContainerConformanceProfile` requires a `terminatorCollision`
  cell.** The container conformance kit grew a sixth invariant, that a body line reproducing the
  container's own terminator stays inside it, and the cell is required rather than optional, so an
  external profile written against 0.9.35 stops compiling until it declares one. Declare `assert`
  and supply a `terminatorCollisionFixture`, or `exempt` with a reason where the terminator is a
  fixed token with no length to grow. Required on purpose: the collision is invisible to byte
  round-trip, so an optional cell would have been left undeclared by exactly the containers that
  need it.

- **A copy starting inside a container's title keeps the container.** Selecting from mid-title (or
  mid-`<summary>`) down into the body yielded the title's tail with no syntax around it and the
  body flat beneath, so `:::note Ti|tle` through the body pasted back as three bare paragraphs
  with the callout gone. The chrome tail is now re-emitted as the container's own opener and the
  container closes where the collection walk leaves its subtree. The wrapper comes from one
  `rebuildRaw` call over the collected body, so opener and closer cannot disagree about a fence
  width the body escalated, and the line ending comes off the live container. Nesting composes:
  only the container a start actually opened ever closes.

- **Plugin surface: `rects.navigateTo(path)` — a navigation that lands the caret.** The rect
  surface's `scrollTo` brings a block into view and leaves focus wherever the gesture put it,
  which for a table-of-contents entry is the entry's own `<button>`: inside the editor, on no
  block, and so outside the reach of the editor's own chords. A Ctrl+Z immediately after a
  navigation click did nothing — which stopped being cosmetic when navigating into a collapsed
  container started committing an expansion, since the gesture that made the edit left focus
  where the undo for it could not be typed. `navigateTo` reveals, scrolls, AND places the caret
  at the target, through the same restore road undo and `setSelection` use, so a navigation and
  a restore cannot diverge on how a target is resolved, clamped or revealed. The bundled `[[toc]]`
  block navigates through it; the workaround its spec documented (put the caret back first, then
  press Ctrl+Z) is deleted, and the spec now types the chord straight after the click.

- **The reveal anchor takes per-call ownership, and pins the full target path.** The anchor is one
  slot holding the block a reveal is fighting to keep on screen, and two claimants inside its
  settle window used to clash on it: an earlier reveal's terminal release — a `'center'` refine, a
  failed mount, a consumer restore handing the viewport back — could drop a pin claimed after it,
  and only one of the three release arms checked (by path, so a same-path claimant lost its band
  anyway). `scrollTo` now mints a claim: a claimant may release only the pin it still holds, and a
  superseded reveal also stops refining, so two navigations racing settle on the newer target
  instead of fighting over the scroll for the rest of the older one's settle. The user still
  outranks every claimant — a keydown, pointerdown or wheel in the document releases the slot
  whoever holds it, and because that is the reader taking over rather than a rival reveal, it ends
  the pin without ending the settle: an ordinary gesture during a reveal leaves its outcome exactly
  as it was before claims existed. Second half of the same redesign: the pin names the FULL target path. It used
  to narrow to the top-level ancestor, which resolved correctly inside the settle loop but held
  the CONTAINER afterwards, so a container taller than the viewport plus a late image decode
  re-asserted the container's top and pushed the already-resolved nested target back out of view.
  `scrollTo` also grew a `hold` option: the consumer restore door passes `hold: false` and hands
  the viewport straight back (it was doing this by path comparison), while a navigation and the
  search band hold by default.

  **Migration note for a host that branches on `setSelection`'s boolean.** Its meaning is unchanged
  (placed AND in view), and the three `false` shapes are the same three. What is new is one more way
  to reach the third: a later programmatic reveal — your own `scrollTo`/`navigateTo`, or the find
  bar navigating — issued before a restore settles now takes the viewport, and the restore stops
  competing for it. **The caret is placed in that shape**, as it already was in the other viewport
  shape, so a fallback that re-places a default selection on `false` will discard a correctly
  restored caret. Branch on it as "the viewport did not end up where I asked". An ordinary user
  gesture during the settle is deliberately NOT this case and does not change the outcome.

- **Plugin surface: `!` takes an inline prefix rung.** A registration on `!` carrying a `![[` prefix
  and a priority below `INLINE_PRIORITIES.builtin` now registers instead of throwing, so an
  Obsidian-style `![[embed]]` can be a real inline kind — recognized, rendered, caret-addressable —
  rather than a view-only decoration painted over bytes the tree never sees. `!` was rejected
  because it sits outside the scanner's fast-bail character set (it only matters inside a
  `[`-bearing range), which would have left the rung a silent no-op in plain prose. The fix is a
  third route rather than a fourth special character: `!` is now **scan-probed**, and a registration
  turns the bail's per-character probe on for it — the same probe the unreserved triggers have
  always used. Making `!` unconditionally special would have been a shorter diff and a permanent tax
  on prose, dragging every `"Hello!"` through the full scan loop for a syntax most documents never
  contain; with nothing registered the bail is unchanged down to the single always-false test per
  character it already paid. Dispatch order is untouched and was the deciding constraint: a prefix
  rung is consulted before the switch, the only position that can work, since `handleBang` consumes
  `![` as one unit and advances past it. So a rung on `!` is an explicit claim to outrank the image
  case wherever its prefix matches, not a claim that the grammars are disjoint — `![[a]](u)` is an
  image whose alt text is `[a]`. Declining that overlap is the recognizer's job, and a decline
  leaves the built-in image reading byte-identical bytes. `]` stays rejected: no construct has asked
  for it, and an unused route is a route that rots.

- **Plugin surface: a rung that mints a built-in `image` re-serializes its own bytes.**
  `InlineSyntaxOptions` gained `rewriteImage`, a hook the image edit paths hand the node's current
  source and the fields the edit produces; it returns the replacement in the rung's grammar, or
  `null` when the edit has no form there. Without it a resize turned `![[cat.png|300]]` into
  `![cat.png|320](cat.png)` — the consumer's syntax destroyed by a drag, and invisible to a
  round-trip check because the document round-trips perfectly, just as something else. The write
  paths could not have known: a node carried no record of who claimed its bytes, so the scan now
  stamps the claim on any **built-in** kind a rung mints, which is exactly the borrowing case. A
  rung's own kind is left unstamped on purpose — the editor has no grammar for one, so nothing
  outside the plugin could ever re-serialize it, and the stamp would have no reader. The safe
  default is a decline, not a rewrite: a rung with no hook, or a hook that returns `null`, gets no
  commit at all, so the affordance visibly no-ops and a dev build names the rung. Suppressing the
  handles instead was the tempting UX and the wrong rung of the ladder — it covers only the no-hook
  half (a hook may decline one edit and accept the next), leaves the properties popover with no
  handle to hide, and would put the rule at three render surfaces rather than at the one seam every
  write already crosses. That seam is now the funnel: the GFM serializer sits under
  `buildImageEditBytes`, because the three write sites that reached for it independently — commit,
  keyboard resize, popover dirty check — all emitted GFM, which is the sibling-path shape. The
  funnel is held by a name scan (G4.21) rather than by the type system: the serializer carries its
  own unit suite, so it cannot be unexported, and what the lint pins is that no module outside the
  seam names it and no undocumented site names the seam. A write path that hand-rolls the GFM
  bytes would still slip past — the honest limit of a scan, stated so the next author does not
  read it as a proof. Images the built-in scanner read are unaffected, including the overlap a rung
  declines. Taken pre-freeze because the alternative is a 1.x break: the hook is the difference
  between an inline rung being able to mint built-in kinds and only pretending to.

- **`setSelection` puts a `getSelection()` snapshot back, and its boolean means in view.** The
  instance surface gained the write half of the save-and-restore pair a host needs to persist a
  per-document caret. It is async because the target may be a block the virtual window has
  unmounted, so the restore reveals it and settles the scroll before placing the caret — and it
  resolves through the same `scrollTo` semantics, so `true` means genuinely in view rather than
  merely mounted. Restore is now **one seam** rather than two: undo/redo already carried the
  recipe inline, and adding a second copy beside it would have been the sibling-path-parity shape
  that produced most of the 2026-07 audit's corruption findings — so the rule moved into the seam
  and both entry paths funnel through it. That relocation fixed a live undo defect on the way: the
  reveal now targets what the applier actually parks at, which for a table endpoint is the deep
  cell, not the table block whose rows window independently. Declining is never a throw: an
  unresolvable path is refused before anything happens — no scroll, no focus steal, no state write
  — while the two ways a resolvable target can still fail to land are reported as `false` with
  their side effects already run.

- **`onPasteImage` is the import hook for an image-bearing paste.** Each image on the clipboard is
  offered to the host in order; the Markdown returned is inserted, `null` skips, and a rejection
  surfaces on the `error` channel while the remaining images still land. Installing the hook takes
  the whole paste — the clipboard's `text/plain` does not also arrive — and N images are one
  insertion, because one paste gesture is one undo entry everywhere else in this editor and
  per-image insertion would make one Ctrl+V need N Ctrl+Z. The arm lives in the clipboard seam the
  four editable surfaces already share, so each surface threads three inert values and no logic;
  the alternative was a rule carried at four call sites. Two behaviors were pinned rather than
  left to discovery: an image paste **replaces** the selection it lands on, cross-block included
  and by inheriting that route rather than placing anything itself (proven byte-identical to
  pasting the same string as text), and the selection is offered to the delete only after the hook
  has answered, so a declined or failed import destroys nothing.

- **`scrollMode='host'` lets an ancestor own the scroll.** The editor root stops being a scrollport
  and grows to its content, for a shell that stacks several documents in one scroller. The trade is
  stated rather than hidden: windowing is gated off above the watermark, so every block stays
  mounted and the mode forfeits O(viewport) — it is for small embedded documents, never a whole
  file. Reveal stays honest there by measuring what actually bounds the editor's visible box, which
  turned out to be two different questions that one walk cannot serve: what a drag may autoscroll
  is the nearest ancestor a **user** can scroll, while what bounds visibility is the whole chain of
  clipping ancestors intersected with the window — the merged predicate was wrong exactly where
  each other's case applied, and a rounded card with `overflow: hidden` and automatic height
  matched it while being neither. Splitting them also surfaced three autoscroll sites that had
  assumed the root and were dead in any host embedding; they now share one resolver, and making it
  a required dependency is what enumerated the fourth.

- **A `header` slot renders host chrome inside the scroll container.** A title, a properties panel
  or a tag row mounts above the first block and scrolls away with the document — which is what lets
  an embedder have both its own chrome and the editor's scrollport, where chrome mounted outside
  would need an outer scroller and forfeit windowing. The slice math needed nothing: a scope
  already measures its list's live offset, so a preamble shrinks the window rather than displacing
  it. What it needed was the anchor correction — the slot's height is outside the height model, so
  a slot that grows while the reader is scrolled down routes its delta through the same
  compensation a measured-in block does, and the document does not slide under them. Inert in host
  mode, where the shift belongs to the page. The slot also invalidated a premise three keystroke
  paths shared — "inside the editor root" had meant "the editor's own content" — so a host title
  field was losing `Mod+F` mid-typing; the fix is one predicate at the dispatch entry, above every
  arm, so arm N+1 inherits it instead of having to remember. The same predicate answers the two
  other places that asked the root: `caretRect()` no longer reports a caret in the host's chrome as
  the document's (a consumer polling it would float caret-following chrome over the host's own
  title field), and a switch into reading mode no longer blurs a focused header field. The rules
  that ask "did focus leave the whole widget" keep using containment — for them the slot IS the
  editor.

- **`--editor-font-size` is a published theme token.** The editor's type scale is `em`-relative
  throughout, so one override scales headings, code, markers and chrome together. It is declared at
  `.editor` like every other token, which means it **shadows** a value inherited from a host
  wrapper: a host overrides at `.editor` scope, and bridges a dynamic ancestor value through a
  property of its own. Mode-independent, and pinned by the manifest that holds the guide's role
  table and the token set set-equal. Virtual rendering follows the scale: the height oracle's
  estimates are calibrated at one font size and the type scale is font-relative, so a host that
  doubled the text made every estimate several-fold short — and since the activation decision reads
  the estimated total, a document whose rendered height cleared the watermark could fail to window
  and mount whole. The estimates now read the root's live computed font size, and a change runs the
  width-invalidation path, so a zoom control is a supported use of the token rather than a
  mount-time-only one. A font-size change resizes no other box in the root, hence the one-`em`
  probe: nothing else reports it.

- **A pathological regex query can no longer freeze the editor.** Regex find runs off the main
  thread under a hard deadline; on overrun the worker is terminated and the find bar reports the
  scan as too slow, the way it already reports a pattern that will not compile. Catastrophic
  backtracking (`(a+)+$` against a few dozen characters) is unbounded work inside a single
  `RegExp.exec`, and a main-thread time budget cannot interrupt one exec — the editor froze for a
  minute per edit and the only recovery was a reload. So the bound had to be a thread that can be
  killed, not a budget that can be checked. Literal search is untouched and stays synchronous, which
  keeps the common path at zero new risk; only regex leaves the main thread, and its results are
  epoch-tagged so a superseded scan cannot repaint over the query that replaced it. The worker ships
  as source text through a Blob URL rather than a bundler worker import, leaving dist packaging and
  consumer bundling alone. Where workers or blob URLs are unavailable — SSR, a CSP-restricted
  embedder — the same seam falls back to a synchronous scan that can only check its deadline between
  blocks, so one runaway exec is still unbounded there: a documented limit of the fallback, not of
  the design.

- **A document swap restarts the find bar's navigation instead of carrying its position.** Swapping
  the `source` prop under an open find bar left the active-match index where the previous document
  had put it, so navigating to `3 / 3` and then swapping to a five-match document read `3 / 5` on a
  document the user had never navigated. The edit epoch could not tell the two apart, since a
  keystroke and a whole-document replacement both bump it; the editor now publishes replacements as
  their own signal and search restarts on that alone. In-place edits, undo and option toggles keep
  the user's place deliberately — they leave the user reading the same document.

- **Enter inside a revealed inline source splits the block instead of only committing it.** The
  reveal used to claim Enter as a commit gesture, so the press never reached the split: at a
  source's leading edge it moved the caret past the widget instead of pushing content down, and on
  a source already backspaced into plain text it did nothing a user could see, leaving the split to
  a second press. Enter now commits the edit **and** splits at the caret, so the press is strictly
  more productive than the one it replaces. Escape stays the reveal's only claimed key; the fold
  triggers it already had — blur, a caret leaving the source, a clipboard splice — are unchanged,
  and any block command now folds before it mutates, which is what makes the split land on
  committed bytes. This reaches all three reveal-capable inline kinds (math, directive text,
  footnote references). One deliberate exception: inside a table cell Enter is a row hop rather
  than a split, and hopping would carry the ephemeral edit out of the surface that owns it, so a
  cell's Enter still commits and stays put.

- **Plugin surface: `getContentVersion`, the memo key for a widget that derives from the whole
  document.** An inline widget component is mounted with three live getters beside its frozen
  `{ inline, source }` snapshot, and this is the third. It is a number that changes whenever the
  document's serialized bytes change and is stable otherwise, which is the thing the surface had no
  way to express: the editor's document is mutated in place, so its object identity survives every
  edit, and a memo keyed on the document itself hits forever and hands back a stale answer. Footnote
  numbering is the shipped consumer and the reason. Each mounted `[^label]` widget derived its own
  number by walking every prose leaf, so a flush cost O(widgets × leaves); it now reads the version
  inside its derived, where the single read is both the reactive subscription that keeps the live
  renumber and the key that collapses the flush to one shared walk. Measured per flush: a
  40-paragraph document with 20 references goes from 4.2 ms to 0.41 ms, and a 200-reference dense
  shape from 38.2 ms to 0.27 ms, the superlinear curve flattened. The version is deliberately NOT
  the decoration engine's `editEpoch`, and the two now state which is which: the version moves at
  render cadence, so a keystroke changes it immediately, while the epoch moves at edit-event
  cadence and is debounced while a typing batch is open. A widget renders mid-burst and needs the
  first; a decoration source runs only from `provide`, which the epoch already drives. Lazily
  computed, so a document nothing memoizes against pays nothing; optional, so a bare harness mount
  still renders (walking unshared, which is correct and merely uncached).

- **A mutation that folds a live reveal now waits for that fold's write, not for one tick.** The two
  seams that fold before they mutate, the clipboard splice and the block command dispatch, each
  waited exactly one `tick()`. The defect ledger held that a kind-changing commit landed its BYTES
  asynchronously and could therefore lose that race; measuring it disproved that, on both the
  top-level and the container path — the commit ceremony mutates and publishes before its own first
  `await`, so the bytes are there the moment the call returns. What is genuinely async is the
  commit's **completion**, whose `afterTick` caret landing Task 3 made awaitable precisely because a
  landing can be async. So the old one-tick wait outlasted the commit by accident of which promise
  chain registered first, not by contract. The fold now returns the write's completion alongside the
  committed caret, and every caller awaits it: cut, paste, the block command, and the click that
  reopens a reveal on a second widget. Both seams moved together deliberately, since one of them
  holding a stronger definition of "settled" than the other is worse than a shared limit. Nothing
  user-visible changes at today's timing; what changes is that the ordering is now stated rather
  than inherited from microtask scheduling.

- **A thematic break takes whole-block focus before it is deleted.** A caret-adjacent Backspace
  (or Delete from the block above) now focuses the rule, and only a second press removes it — the
  two-step the mermaid diagram has always had, and which the thematic break's own closure cells had
  been claiming while the descriptor declared nothing and the block vanished on press one. The
  descriptor now declares `blockFocus: 'whole-block'`; the component needed nothing, having carried
  the focus ring, the tab stop and the focused-block key tail since whole-block copy shipped. Ranged
  and sweep deletes are untouched — this is the caret-adjacent gesture only.

- **Breaking, freeze surface: `parseInline` rejects a call that omits its scan bounds.** Called with
  the source alone, it used to compare against `undefined` at every step, skip the scan, and hand
  back a single text node holding the whole string — no throw, no warning, and the inline structure
  the caller asked for silently absent. It now throws a `TypeError` naming the fix. TypeScript
  callers were never able to make the call; this closes it for plain JS and `any`-typed sites.

- **A closure cell that claims focus-then-delete must be backed by the declaration that provides
  it.** The bootstrap coherence family gained two rules: a kind whose `focus` or `mergeBackspace`
  cell claims the focus-then-delete model has to declare `blockFocus: 'whole-block'`, and a
  `reservedChrome` container has to say what its clipboard does rather than inherit the default.
  A closure cell is prose a compiler cannot read, so the honesty of the matrix rested entirely on
  review — and the thematic break above is what that gap looked like in a shipped built-in.

- **The state registry stops calling a remount handoff a double claim.** The
  `[state-registry] double register` warning fired on every list indent, because indenting splices
  the item's NODE into a new parent and Svelte creates the destination mount before tearing the
  source one down — so at registration
  time two states legitimately claim one node. Nothing in that instant distinguishes the handoff
  from the corruption the warning is for, so it now re-asks once the flush settles: the loser that
  gave up its child refs was torn down, and the one still holding them is a second live component
  writing into a state nothing can resolve. Characterized before it was touched, and the winner was
  always the live mount — no stale entry, no symptom, which is why this is a signal fix and not a
  behavior one. The message names the real failure now instead of guessing at two causes, and the
  handoff's other direction (the registry landing on the dying mount) is pinned through a real
  indent gesture, which nothing covered before.

- **A big paste into a long list no longer loses the caret (VR-12).** Every structural paste lands
  the caret at the END of the pasted run, so its target index is offset by the CLIPBOARD's block
  count — unrelated to where the caret was. All five routes reached that target through a
  synchronous ref lookup, which cannot mount an off-window block, so once the pasted run cleared the
  render window's overscan the landing silently no-op'd: the user pasted, typed, and nothing
  happened anywhere in the document. The ledger named one route; the pinned repro exercised a
  different one, which is the tell that the bound was on the wrong thing. A landing index that
  scales with the clipboard is the defect, and every structural paste has one, so the fix is a
  single reveal seam the paste layer lands through — doc-absolute path in, scroll-mount-focus out
  — rather than five callers each remembering. Reaching it required the commit ceremony's
  post-tick callback to be awaited, which it now is: the promise a commit hands back means the
  edit AND its caret have settled, and a reveal is bounded (it degrades rather than waiting for a
  mount that can never fire), so awaiting cannot hang. Widening that callback's return type also
  surfaced a landing that had been silently discarding a boolean the whole time. Documents small
  enough that the target was already mounted are unchanged down to the absence of a scroll: reveal
  skips a mounted target without touching the scroll position.

- **A structural paste mints its blank-line rows at the target document's ending.** Pasting content
  with an internal blank line into a CRLF document left a lone LF row behind: paste normalizes the
  clipboard to LF before parsing, so the trivia those rows materialize from cannot tell a CRLF
  document from an LF one, and the ending has to come from the paste target. The line-ending
  parameter behind the mint is now required rather than defaulted, which is what turns the next
  such site into a compile error instead of a silent downgrade.

- **A directive document whose closer lines are all too short to close anything parses in linear
  time.** The closer index bounded the unclosed-opener flood, but the lookup into it still walked
  forward from the first later closer until it found a colon run long enough — so a document that
  contains no such run walked every closer for every opener. The lookup is now a descent over a
  max-of-counts tree, indifferent to how the run lengths are distributed. Bytes are unchanged;
  256 KB of the adversarial shape went from roughly 2.4 s to 53 ms.

- **An emphasis-dense paragraph parses in linear time.** Resolving a delimiter pair spliced the
  pair's interior out of a flat working-node list, costing one scan to locate each run node plus
  one tail move per pair, so a block that is nothing but pairs cost `O(pairs^2)`: 96 KB took
  137 ms, and 800 KB took 92 s, which is one ordinary paste and a reload to recover from. The
  pairing algorithm was already the reference's amortized one, openers_bottom and all; what was
  missing is the other list commonmark.js keeps linked, the inline nodes themselves. A pass now
  takes a doubly-linked window over the working nodes its floor can reach and detaches each
  interior by relinking two ends, so nothing in the pairing decision changed. Bytes are unchanged
  and the conformance baseline did not move; 96 KB is now 16 ms and 800 KB 129 ms.

- **The editable surfaces thread their instance grammar into cross-block join-paste.** The seam
  field was optional and none of the four production surfaces supplied it, so the join reparse always
  used the global grammar. It is now required-nullable, matching the dispatch tier it feeds: a
  surface must answer the question, and `undefined` means the global grammar deliberately.
  Byte-identical today, since an instance grammar cannot yet diverge.

- **Navigating into a collapsed container opens it instead of doing nothing.** A collapsed
  collapsible clamps its render window to the chrome row, so a reveal aimed at a body child found
  its target outside the live window and returned: clicking a toc entry for a heading inside a
  closed `<details>`, or navigating to a search match found there, was a dead click with no crash
  and no error to notice. The reveal seam now opens the container first. Expansion is a real
  committed edit, not a view-only override: the `open` state is serialized bytes, so a transient
  flip would put the view and the CST into exactly the disagreement the architecture forbids. One
  Ctrl+Z therefore takes it back, the `edit` event sees it, and the commit error seam contains it.
  Which containers can be opened, and how, is declared rather than special-cased. **New plugin
  surface: the container contract's `reservedChrome` gains an optional `expandPatch` field**, a pure
  hook returning the metadata that opens a collapsed node, declared beside the `isCollapsed` probe
  the window clamp already reads. Additive, so no existing plugin changes; a collapsible that
  declares no door keeps degrading exactly as before. Reading mode expands nothing,
  since a mode that commits no edits cannot make an exception for this one. Nested collapsed
  ancestors each open, outermost first, and each is its own undo entry: batching them into one would
  have put commit vocabulary into the navigation signature a plugin author is about to be frozen
  against, for the doubly-nested case alone.

- **The adjacent-widget-boundary click-snap flake was the spec's own race, not an editor
  defect.** The geometry read ran with no image-decode barrier, so a pre-decode 0x0 widget box put
  the click inside the image once it decoded, and the widget select suppressed the snap caret. The
  spec now waits for the decode and asserts the specific edge; the ledger entry's original suspect
  (the reveal-anchor pointerdown clear) is falsified in the entry's closing record. Reproduced
  naturally at 15/60 under contention, 180/180 green after.

- **The byte-corruption family from the 0.9.35 review is closed.** Typing `:::` in an admonition
  body no longer truncates the container: every directive container escalates its fence past the
  longest body colon run at the one serializer choke point, narrowing again when the collision
  goes, and G1.12 now guards the directive tier it used to exempt. `</details>` has no fence to
  grow; that collision is proven unrepairable at the rebuild seam and pinned as a guarded floor
  (loud in dev, bytes round-trip), ledgered with the commit-path design it needs. Shift+click out
  of a table cell mints a cell coordinate instead of a character offset, so copy no longer drops
  the header row; every cell write escapes freed pipes over the post-splice raw at a schema
  descriptor seam the tree-op sink applies (the rule had been carried at call sites, and the one
  bare sink deleted a column); a cross-block delete from prose into a table terminates the
  truncated head line, so the next parse no longer swallows the table; and a plugin throw inside
  the commit ceremony rolls the tree back byte-identical and lands attributed on the error
  channel, from every gate including the paste path. Alongside: word-modifier chords no longer arm
  a destructive widget state, a selected widget declines chords instead of eating Mod+Z, deleting
  a link-reference definition refreshes the resolver, `(www.)` stays literal, and the
  ambient-marker pin covers all four inline wrapper shapes.

- **The suite now reaches what shipped its misses.** Component-level mount suites cover the
  highest bugfix-density files that had none (blockquote, list, table, BlockHost, the cross-block
  keydown dispatcher), and finding two latent byte defects on the way is what the program was for.
  The property lanes reach bundled-plugin syntax, 100 KB inputs, the 0-3-vs-4 block-indent
  boundary, and CRLF documents holding structured blocks — each previously outside every
  generator's expressible space. Repo-wide source lints scan the reference plugins and the
  consumer example; a settle whose expectation is a substring of the loaded content now fails a
  lint (58 sites repaired); and the e2e invariant watcher names its expected tags instead of
  waiving whole files. Two live defects the new oracles surfaced are ledgered with executing
  repros rather than fixed: typing a `> [!TYPE]` marker per keystroke never forms an alert, and a
  long paste into a windowed list loses the caret (VR-12).

- **A desktop shell's asset URLs pass the image-src allowlist.** `asset:` joins `http`, `https`
  and `data` as an allowed image scheme, so an editor embedded in a webview shell renders a local
  file the host resolved for it. The defect this closes is platform-shaped, which is the reason it
  is worth a scheme rather than a workaround: Tauri's `convertFileSrc` returns
  `http://asset.localhost/…` on Windows and `asset://localhost/…` on macOS and Linux, so a host
  whose images all rendered on the developer's machine had every one of them blocked — GFM and
  plugin-minted alike — on two thirds of its platforms, with nothing a Windows CI could see. The
  scheme carries no script capability: no browser resolves it, and a webview that does serves
  bytes off disk. Hrefs are unchanged — an asset URL is a src, and nothing has asked to navigate
  to one. A consumer-extensible allowlist is the obvious generalization and is deliberately not
  taken here: a host may name its own protocol (`convertFileSrc(path, 'myasset')`), so the general
  answer is a contract surface to settle at the freeze, while this is the one name the platform
  publishes.

- **The widget-free image path prints its own bytes.** A table cell renders an image as source
  rather than as a widget, and it rebuilt that source from the parsed `alt` assumed to sit two
  characters into the node — true of a GFM image, false of one a plugin mints, so an
  Obsidian-style `![[cat.png]]` in a cell displayed as `![cat.pngg]]`. The parsed field now only
  _locates_ the marker split, and only where it is literally those bytes; every string the path
  emits is a slice of `raw`, which is the rule the link path beside it already carried and stated.
  An image whose alt cannot be located renders as unmarked source rather than as markers, because
  a marker collapses in reading mode and collapsing a construct nobody can decompose would blank
  it outright. Offsets were never affected — the arithmetic always spanned the node — so bytes,
  selection and serialization are untouched and only the glyphs change.

- **A cross-block copy whose event lands on nothing now writes anyway.** Select the whole document
  and press Ctrl+C: if the selection's focus endpoint was a block with no text position in it — an
  image-only paragraph, a thematic break — the system clipboard was left completely untouched, so a
  paste into another application produced nothing. The endpoint is where the trail starts: a
  cross-block selection is painted by overlays, and the collapsed caret the seam parks at the focus
  endpoint is best-effort, so a caret-less endpoint leaves the native selection empty. Chromium then
  dispatches `copy` at `document.body` rather than at the focused block, and every clipboard handler
  in the editor was bound to a block surface. Nothing above them listened, so the gesture died in
  silence — no throw, no empty write, just an untouched clipboard. The editor root now carries the
  fallback, the exact sibling of the root keydown routing that already covers a windowed-out caret's
  chords: an event that landed on the root or on the body, with a cross-block selection live and no
  block having claimed it, routes into the same cross-block clipboard seam the blocks call. Cut and
  paste were fixed with it rather than after it — they escape through the identical hole, and cut
  was the member that silently dropped the gesture entirely. The gate stays narrow on purpose: it
  reads the event's own target, not the focused element (a block still held focus in every
  reproduction), and it claims only the root and the body, so the find bar's input and a host's
  header field keep their own clipboard.

- **Mod+B / Mod+I do something at a collapsed caret.** They used to read the live selection,
  find null, and return — while still claiming the key, so the chord was a dead press with no
  feedback of any kind. The contract is now the mainstream one, stated here because it is a
  choice and not a bug fix: at a collapsed caret the toggle inserts the empty marker pair and
  lands the caret between its halves, so the next character typed is formatted. Two arms come
  before the insert. If the caret already sits inside a span of that format the span is
  unwrapped — a caret in `**bold**` turns bold off, which is what the press means there and
  what Obsidian's toggle-the-whole-word rule exists to deliver; this reaches it through the
  inline parser instead, and the editor grows no word-boundary rule it would then have to be
  consistent with elsewhere. If the caret sits between the halves of an empty pair, that pair
  is removed, so a second press is an undo of the first. One Ctrl+Z also removes the pair — and
  if text was typed inside it first, that same press takes the typing with it: the toggle joins
  the typing checkpoint it opened rather than standing alone, which is the existing batching
  rule for any content edit at a caret and is not special-cased here. Table cells carry
  the same contract off the same pure core, and their toggle now claims the chord even when
  there is no caret to act on — declining would leave the browser's own contenteditable bold to
  run in a surface the CST owns.

- **A click in the editor's dead space places a caret.** Clicking below the last block, or in
  the root's own padding beside a line, used to move focus to the root and place no caret at
  all — a click that did nothing a user could see, on the two regions a user most often clicks
  when reaching for "put the cursor at the end". Below the last block now lands at the end of
  its content; beside a line lands at the end of THAT line, which is what makes the gesture
  worth having on a wrapped paragraph. The rule carries no kind knowledge: the point is clamped
  into the nearest block's box and handed to the hit test the drag path already uses, so a
  container is descended into for free and the end-of-document gesture is just the same clamp
  aimed at a trailing corner. Clicks that land on anything the editor renders — a block, a
  handle, an overlay, the host's header slot — are untouched, because the claim is on the
  event's target being the root itself. Two families declined rather than guess: a table, whose
  offset is a cell index and so has no "end of that line", and a non-editable leaf like a
  thematic break, which would otherwise take the whole-block focus a click ON it means and arm
  the next Backspace against a block the user only clicked near. The table half is closed later
  in this same release, by a kind declaring `caretTargetAtPoint`; the leaf's decline is the
  answer rather than a gap, and is recorded at the seam and in its requirement.
  A drag-select that ends in the margin keeps its selection.

- **A reveal click on a rendered block no longer leaves the whole document armed for
  deletion.** Clicking the rendered view of a render-primary leaf — block math, the table of
  contents, a footnote definition — reveals its source and lands a caret in it, which makes it a
  caret-placing gesture. It was the one such gesture that skipped the shared pointerdown
  preamble, so a live cross-block selection stayed painted over a caret that had just moved out
  of it, and the next Backspace deleted the range rather than a character: select all, click the
  math, press Backspace, and the document was gone. It runs the preamble now. It still does not
  route through the cross-block dispatcher the source surfaces use, because that hit-tests the
  pointer against source text a rendered view does not have. Found by writing out the entry set
  for the new guard below rather than by a report, which is the entry set's whole point: the rule
  that a caret-placing gesture ends a live range is carried by each gesture, and
  `invariants/lint/caret-gesture-range-reset` now makes a gesture that joins the set declare
  which door it uses — or say what it does instead of placing a caret. That the rule could not be
  seated in one verb was measured rather than assumed: `BlockComponent.focus` was the obvious
  candidate and was the same call the cross-block dispatcher parked its own caret with mid-extend,
  so a clear seated there redded three extend specs. That measurement is what forced the verb
  split above (`focus` ends the range, `parkCaret` carries the extend paths), which makes the
  range-ending landing the default a caller inherits by doing nothing. G2.12 holds the gestures
  no verb can reach; the consumer-facing door that ends a range is `setSelection`.

- **A ranged edit spanning a fence line stops corrupting the fence.** Select from a fenced code
  block's last body line through its closer, press Backspace, and the committed block was an
  unclosed fence that absorbed every following block at the next parse. The block's own gestures
  each declined on sight of a range — `codeBackspace`/`codeDelete` bail when the selection is not
  collapsed, and `onBeforeInput` claimed only `insertText`/`insertLineBreak` — so the native edit
  landed in the contenteditable and the surface committed whatever text was left. The fix is one
  seam rather than a clamp per gesture: every native edit that rewrites a range now passes a
  beforeinput guard that reads the pending edit's own target range and re-sites it onto the body,
  and cut and paste's pre-delete share the same splice. Reading `getTargetRanges()` rather than
  the selection is what makes a word delete and a Backspace at the closer line's start members of
  the same case — both are ranges the browser derived, and both fused a fence line before. An IME
  cannot be guarded there (`insertCompositionText` is not cancelable), so a fence-crossing
  selection is shrunk onto its body span at `compositionstart` instead. The contract: mutations
  clamp to the intersection of their range with the body, so a fence-only selection is inert,
  while copy stays verbatim with the literal bytes — cut is a verbatim copy plus a clamped delete,
  by design and stated where the requirement defines it. What the clamp spares is the block's
  editable **content** — its body and the opener's info string — and nothing else, because the
  parser draws that line and not a tidier one: one deleted closer backtick leaves a fence that
  never closes, one deleted opener backtick demotes the block and promotes its closer to an
  absorbing opener, one character typed into the closer run does the same, and a fourth leading
  space on the opener demotes it to an indented code block. So both marker runs are structure,
  and every gesture that writes is inert inside either — typing, deleting, cut and paste alike,
  including the auto-pair delete, which reads a caret between two backticks as a pair and now
  declines when that pair is a fence. One predicate answers for all of them, because the paste
  route splices through the tree-op rather than through the surface's own edit, and a rule that
  each entry path carried a copy of is a rule one of them would eventually not carry. Caret
  LANDINGS clamp with it: `focus` and `focusAtColumn` seat the caret on editable content, so a
  door that aims at a fence line — the cross-container merge fallback moves focus to a block's
  END, which is the closer run — no longer hands the user a position whose next keystroke
  disappears. Arrow navigation and clicks can still park there; that half is in the ledger. The
  one exception is an UNCLOSED fence: with no closer to orphan, its markers stay editable, because
  demoting the block is how a just-typed ` ``` ` is un-typed and nothing can be absorbed. Two
  consequences beyond the bug: select-all then delete inside a code block now empties the body
  and leaves a code block (the unguarded native delete of the whole display left a paragraph),
  and un-fencing a CLOSED block by editing its markers is no longer a gesture — the exits are
  emptying it or deleting the block whole. What an edit _writes_ into a content region is a
  separate rule that stays unpoliced and is now tracked in the defect ledger: a backtick typed
  into a backtick fence's info string still breaks the opener.

- **Enter inside a closing fence no longer breaks it, and Enter over a selection replaces it.**
  The Enter splice was clamped out of the opener line and not the closer, so a caret placed in the
  closing ` ``` ` spliced a newline through it and left an unclosed fence — the collapsed-caret
  sibling of the ranged-edit bug above, found while enumerating that family. `clampEnterOffsetToBody`
  is symmetric now: a caret strictly inside either fence line's text lands on the nearest body edge,
  while each line's inner edge (after the info string, before the closer's backticks) stays put,
  since splicing there is already safe and its caret behavior is pinned. Both Enter members — the
  `code.newline` command and the soft break — now take their span from one helper, which is also
  what makes Enter replace a selection instead of inserting at its start and leaving the selected
  text behind. That silent no-delete had one more edge: the soft break clamped its two endpoints
  independently, so a selection inside the info string produced an inverted span and duplicated
  text. A span cannot invert.

- **The code surface reads no clipboard payload of its own.** The fence guard briefly pulled an
  `insertReplacementText` payload off its `dataTransfer` so an autocorrect over a fence-crossing
  selection could be re-sited onto the body. That is a clipboard/drop read, and G4.11 exists to
  make every one of them declare which sanctioned paste route carries its text through the plugin
  paste transforms — a read that reaches `parse()` without one drops every registered transform on
  that route. Rather than declare the file (an allowlist entry blesses the whole file, so the next
  read added there would pass the scan unseen), the guard now refuses any input type whose payload
  rides an external carrier: a drop, a paste, a replacement. It re-sites only text it can read off
  the event itself or mint itself. The refusal costs a rare mobile autocorrect landing a correction
  across a fence line, which the surface's `spellcheck="false"` already suppresses on desktop.

- **A container re-derives its kind from its own rebuilt bytes.** Typing `> [!TIP]` one key at a
  time left the block a blockquote forever: the promotion at `>` landed, and then every later
  keystroke was an edit to the container's inner leaf, whose reparse can only ever decide the
  LEAF's kind. Nothing asked whether the blockquote's rebuilt raw still opened as a blockquote, so
  the live tree said blockquote while a reparse of its own serialization said `githubAlert` —
  `parseConverged()` false — and the body then concatenated onto the marker line. An atomic
  whole-marker insert classified correctly, because that route reaches `updateNodeContent`'s
  kind-change arm; both drivers in the repo used it, which is why nothing failed. The fix is that
  arm's container twin, run at the ancestry rebuild every out-of-ceremony write, commit scope,
  paste and range-delete already funnels through, so the class closes for containers rather than
  for one marker: a container whose rebuilt raw parses to a different kind is replaced by the
  correctly-kinded node in its slot, keeping its ID (identity rides the parent's parallel id
  array, so the swap carries it for free) and backfilling a caret target. Eligibility is the
  opener registry rather than a kind list — registering an opener IS the claim that `parse(raw)`
  reproduces the kind, so a listItem (`- x` parses to a _list_), a tableRow, chrome and tableCell
  are excluded by construction (so is `table`, which emerges from the paragraph continuation scan
  rather than an opener), and a future container kind opts in by being parseable at all. The
  reparse resolves through the instance grammar — a required-nullable parameter threaded from all
  twelve rebuild call sites, with a source-scan lint refusing an `undefined` answer — so a
  disabled kind stays unreachable. Cost is gated twice, because the reparse is linear in container
  bytes: line 1 must have changed (an opener claims from there), and the rewritten line, read
  alone, must no longer open as the kind the node already is — asked of the registry itself, one
  line at a time. The second gate is load-bearing rather than an optimization: typing into a
  list's first item rewrites the opener line on every keystroke while `- one` keeps opening as a
  list, and without it that keystroke cost 43 ms at 1MB against 0.6 ms with it. It is a positive
  identification rather than a before/after comparison, because a kind whose opener declines a
  one-line probe (a directive container wants its closer) would compare equal on every edit and
  elide a real kind change; the partition of registered containers over that answer is pinned. Two perf rows now type INSIDE a giant container, the
  place no latency row's caret had ever sat, which also put a name on a pre-existing
  non-viewport-bounded axis (`performance.md`): the container raw rebuild alone is ~52 ms per
  keystroke on a 1MB list's head child. The mirror direction is structural (the pass
  compares kinds, not names) but unreachable for `githubAlert` by editing: its rebuild re-emits
  the marker from metadata, so line 1 always re-opens as an alert — a metadata write is the only
  route, and it is pinned as one.

- **A blank line is spaces and tabs, per GFM §2.1 — not everything `String.trim()` strips.** The
  parser's blank-line predicate asked `trim()`, which strips the whole Unicode whitespace set, so a
  line holding one non-breaking space (the commonest artifact of a paste out of a word processor)
  ended its block: a three-line paragraph became two, and an NBSP-only document parsed to zero
  children. The predicate now tests for a character other than space or tab, matching the spec and
  cmark-gfm's own `is_blank`. That moves block structure on four axes at once — where a paragraph or
  blockquote ends, whether a list continues, how far an indented-code run reaches, when an HTML block
  terminates — so each is pinned against commonmark.js's block outline rather than against itself,
  with byte round-trip asserted per fixture. The vertical tab and form feed ride the same route. The
  footnotes plugin carried a private duplicate of the predicate; it is gone, and `isBlankLine` is
  now on the plugin barrel, so the rule has one home. One consequence inside a footnote definition
  is worth knowing: an unindented NBSP line now closes the definition, where cmark-gfm would lazily
  continue its open paragraph — the definition scan models no lazy continuation, which is now a
  ledger entry rather than an accident.

- **The bare-email autolink domain is cmark-gfm's, underscores included.** `a@b_c.com` stayed
  literal here and linked on GitHub, because the domain character class excluded `_`. Widening the
  class alone would have traded one divergence for two, so the domain scan is now the rule
  cmark-gfm actually implements: labels of alphanumerics, `-` and `_`; a `.` separates labels only
  when an alphanumeric follows it; at least one separator; and the last character must be a letter.
  That fixes two more divergences the old per-label hyphen rule carried — `foo@bar-.com` now links
  (its last character is `m`) and `foo@bar.com_` no longer links a truncated address, matching the
  spec's own `a.b-c_d@a.b_` example, which renders literal. Where the spec's prose is explicit this
  module still keeps it against cmark-gfm: the §6.9 leading-boundary rule stays applied to the email
  form, which cmark-gfm exempts, and the www/url `np > 10` underscore escape stays unreproduced.

- **Both GitHub-alert converters take their extent from one authority.** The `source → source`
  stream converter scanned for its own alert extent with a line regex, and a line test cannot
  reproduce CommonMark §5.1 lazy continuation, which absorbs a line only while a paragraph is open.
  It now runs the parser's own `blockquoteExtent` over its line window, so the two shapes that
  forked agree: a plain lazy line stays inside the alert, and an over-indented `>` line following a
  body line that closed the paragraph stays outside it. The parity test's `known fork` block is
  gone — its two fixtures moved into the agreeing table, where they are now regression guards.
  `splitLines` joins the plugin barrel with it: `blockquoteExtent` and `ParsedLine` were already
  public, so the seam was unreachable from a plain string.

- **A CRLF document's GitHub alerts convert.** Both converters re-split their input on `\n`, which
  left a `\r` on every line and made the `> [!TYPE]` marker fail its end-of-line anchor, so a
  CRLF-authored alert converted to nothing at all — even though the same marker rule, asked through
  the parser's line model, opens a `githubAlert` for it. Both now read that line model, and the
  emitted opener, body and synthesized closer each carry the ending of the source line they replace.

- **Testing surface: the convergence oracle's placeholder tolerance follows the parser's blank
  rule.** `parseConverges` drops empty-paragraph placeholders from both sides before comparing,
  because the parser folds them into trivia — but it decided "empty" with `String.trim()`, so once a
  whitespace-only-but-not-blank paragraph became a real node it was dropped from the LIVE side alone
  and a tree one node too long reported convergence. The tolerance now asks `isBlankLine`, the same
  rule that defines what the parser folds. No signature changed, but a downstream profile can newly
  report a divergence it was blind to, including on a tree that previously passed — that is the
  point of the fix, and the compat note.

- **A selection restore no longer emits the selection it is leaving.** Restoring a collapsed caret
  cleared the cross-block state before placing the caret, and the clear notified — so the first
  `selectionChange` of the restore carried the PRE-restore selection, and a persist-on-change host
  that treats the first event of a burst as authoritative saved the wrong one. The same-block range
  route had it too. Reordering the clear was rejected in the issue and stays rejected: it only moves
  which stale value escapes, because the notification reads through whatever state and DOM exist at
  the moment it fires. What changed instead is when the channel is allowed to speak. `SelectionState`
  grew a batch seam that holds notification for the duration of a body and fires it once at the end
  if anything mutated, and the restore road wraps BOTH of its halves — the state write and the caret
  landing — in one. Every mutator notifies exactly as before; the batch decides only when, so no
  entry path's emission count moved. Subscribers read the editor back on notify, which is the whole
  reason the seam has to span the DOM half and not just the state one. Consumers can stop reading
  the selection back after `await setSelection(…)`: the guidance still works, it is simply no longer
  load-bearing. The browser's own `selectionchange` may still deliver a trailing duplicate of the
  settled value; what is gone is the stale one.

- **A paste that consumes the gesture and inserts nothing now says so — new `error` origin
  `clipboard`.** The cross-block paste route's defensive branch (`if (!caret)`) reported the paste
  as handled and dropped the payload. For text the cost is low, since what did not land is still on
  the clipboard; for an image it is not, because `onPasteImage` has already imported the asset by
  the time the caret is asked for, and a host with no signal orphans a file the user cannot recover
  by pasting again. The route now reports on the editor's `error` channel with a sixth `origin`,
  `clipboard`, carrying the range's start path — additive and typed, so a plugin or host that
  switches exhaustively on `origin` sees the new arm at compile time. The alternative costed in the
  issue stays rejected: deferring the hook call until the caret is known good puts the delete before
  the import, so a host whose import fails would wipe the user's selection with nothing to show for
  it. The branch, which the ledger recorded as never reproduced, turns out to be reachable through
  the delete's own re-entrancy serialization — a paste arriving while a cross-block delete is parked
  on its reveal waits that delete out, and the delete collapses the selection on its way through —
  and now has a unit repro. Its residual is filed rather than fixed: the paste's undo snapshot is
  pushed before the delete, so a declined paste leaves one entry that undoes nothing.

- **An image pasted over a selection the block surfaces never see is imported.** When a
  cross-block selection's focus endpoint hosts no caret — its last block is an image-only
  paragraph, a thematic break — the park is a no-op and the browser dispatches the paste at the
  body, where the editor-root fallback runs. That fallback went straight to the cross-block arm,
  which has only `text/plain` to work with, so a pure-image paste was discarded without the host
  hook ever being offered the files. The arm now lives in one seam both entry paths construct,
  rather than the second divergent copy the issue was deferred to avoid: the shared half is
  reading the files, offering each to the hook, and handing the markdown to the cross-block route;
  what stays per-caller is only what needs a caret, which the root does not have. The root's own
  decline — a selection collapsed while the import was in flight, leaving imported markdown with
  nowhere to land — reports on the same `clipboard` error origin, which is the second consumer
  that justified minting it. The root arm prevents before it awaits the hook, the same discipline
  the surface skeleton states, so the browser's native paste cannot fire during an import and
  inject DOM the CST never sees.

- **Every clipboard-route failure reports under `origin: 'clipboard'`, including the two that used
  to say `command`.** Minting the new origin for the cross-block decline left the image arm's own
  two failures — a host hook that threw, and an import that resolved after its block was gone —
  filed under `command`, where a host filtering for the new origin would miss them. Since surfaces
  are where most pastes land, that was the more commonly hit pair, which made the new origin unable
  to do the one job it was minted for: telling a host that an asset it imported is now orphaned. All
  four sites route through one envelope minter, and `clipboard` is documented as what it now covers
  — a failure on the paste route, of which a paste that inserted nothing is one shape and a throwing
  import hook is another. Taken in the same release the origin appears in, so no shipped meaning
  changes: after the freeze this would be a breaking edit to a frozen union's semantics rather than
  the completion of a new arm. `context.path` follows the same honesty rule as the origin: it
  carries the range the paste was aimed at where there is one, and is **omitted** otherwise, rather
  than reporting `[]` — a path that would address the document root, which holds no caret.

- **The simulation now treats select-all → gesture → keystroke as a first-class corruption probe.**
  The precondition behind two whole-document losses — a live cross-block range in front of a
  caret-placing gesture — had never been built by any suite; both were found by reading code, and
  the lint minted from them can only see pointer handlers. The new detour family builds a real
  range, fires one interrupting gesture (dead-space click above prose and above a table, image
  widget click, reorder-grip press, Escape, find-bar round trip, inline and render-primary reveal
  clicks, TOC entry click), types one printable key, and asserts the resulting bytes. The two
  reveal doors are carried as separate gestures because only one of them owns the reset that was
  missing, and a probe on the wrong one passes while the bug is live. Each gesture is pinned to
  ONE of two legal outcomes — the range survived and the key replaced it, or the range ended and
  the key landed where the gesture pointed — and the assertion is equality against that one. The
  distinction is the whole design: accepting either outcome would ship green for the exact bug,
  because a neutered reset makes the corrupt output identical to the outcome the gesture was not
  pinned to, and reading the answer back off the live-range flag self-confirms for the same reason.
  Contracts come from observing each gesture, not from the lint's classification, so the probes
  cross-check it instead of mirroring it; a TOC entry lands its caret through the navigation API
  rather than any pointer door, which that perimeter cannot see at all. Every gesture has a
  deterministic probe keyed by the gesture union, and the family also rides two note sessions and
  the multi-seed fuzz, where the seed picks which gesture meets which mid-session tree.

- **A code block holds content its fence cannot express.** Two characters still broke a fence from
  inside a region the contract calls editable: a run of the block's own marker typed on a body line
  closed the block early, leaving the rest of its body as a fence that swallowed every following
  block, and a backtick typed into a backtick fence's info string demoted the block and promoted
  its closer to the same absorbing opener. Both are now answered where the bytes are committed, by
  one write seam that typing, IME composition end and paste all cross — paste already had half the
  rule (it grew the fence past a pasted run) and the other routes had none, which is the
  sibling-parity shape rather than a missing feature. A colliding body line grows BOTH fence runs
  past it, so the line stays content; that is the move a directive already makes with its colons
  (`escalatedColonCount`), and it is the system widening its own delimiter, not the user editing
  structure — the guard still refuses an edit AIMED at a fence line. The escalation reads the lines
  a write leaves behind rather than the characters it carried, which both narrows it (a run landing
  mid-line threatens nothing) and widens it (a run formed at a splice seam is caught, which the old
  scan of the pasted text alone could not see). The info-string backtick has no such rescue —
  CommonMark forbids it at any fence length — so it is dropped: typing one is inert, a paste lands
  without it, and a tilde fence stays the escape hatch for an author who needs one. Converting the
  author's chosen markers to tildes would make the character representable and is a bigger surprise
  than dropping it. Both rules leave an UNCLOSED fence alone, where typing a closer is how a block
  gets closed by hand. The reconciliation sits inside the block's single display-commit funnel
  rather than at the gestures that write, because a gesture can move an existing body run into
  terminator position without adding a character: Enter splitting a line around a mid-line run, and
  Shift+Tab dedenting a four-space-indented one to column 0, each split the block while the rule
  sat at two of ten commit sites. One door now, pinned by G4.24 against an eleventh.

- **The published `svelte` peer floor rises to `^5.29.0`, and now says something true.** The
  declared floor was `^5.0.0`, but `editable-leaf.ts` imports `createAttachmentKey` from
  `svelte/attachments`, a subpath svelte's `exports` map does not carry before 5.29.0. A consumer
  anywhere in 5.0 to 5.28 could install without a peer warning and then fail to resolve a core leaf
  component at import time, so this narrows the promise to the range that already worked rather
  than dropping anyone who was running. Those two subpaths (`svelte` and `svelte/attachments`) are
  the whole of what the library imports, and nothing else it uses postdates 5.0, so 5.29.0 is the
  floor rather than a version picked off the current install.

- **The `katex` peer widens to `^0.17.0 || ^0.18.0`.** A strict superset, so no consumer is
  dropped: 0.18 hosts are admitted alongside the 0.17 ones that already were. The whole katex use
  is `renderToString` plus the packaged stylesheet, neither of which moved across the two majors,
  and both halves are exercised (the root suites run 0.18.1, the consumer smoke renders on 0.17.0).

- **Dependency floors move to clear seven advisories, and `cookie` needs an override to get
  there.** `@sveltejs/kit`, `postcss`, `brace-expansion`, `dompurify` and `@vitest/browser` all
  reach their patched versions on ordinary range resolution. `cookie` cannot: kit still declares
  `cookie: ^0.6.0` at its latest release, so nothing reachable crosses to the patched 0.7. The
  pin is `^0.7.2`, and the reason it stays on 0.7.x is narrower than a rename. `cookie@0.7.2`
  ships no type declarations at all (its `files` list is `index.js`), so kit's
  `import('cookie').CookieSerializeOptions` resolves through the separate `@types/cookie` package,
  which the override does not touch. A 1.x override would break that by SHADOWING `@types/cookie`
  with bundled declarations that spell the type `SerializeOptions`. Any future typed release, 0.8
  included, would do the same. The field is inert for anyone installing aragonite (npm reads
  `overrides` only from the top-level project) and ships in the tarball as dead metadata.

Ship gates: unit 5913, e2e 1680, check 0/0, lint 0, perf:check 13/13 gated rows (the gate
was restructured this minor — the 24-row count was the 0.9.35 spec layout — and gained two
container-head rows plus the row-shape verification at the batch base). The e2e figure is the
last full battery's; the unit figure is current.

### 0.9.35: the navigation API + toc v2

- **`rects.scrollTo(path, opts?)` is the public navigation seam.** It mounts a windowed-out target, scrolls the viewport to it, and resolves `true` only once the position settles, so the boolean means genuinely in view. `reveal(path)` keeps its mount-only semantics.
- **`BlockComponentProps.rects`** hands a block component the owning instance's rect surface, so it can reveal, scroll and measure without an editor context it does not have.
- **The toc plugin became a real table of contents.** Entries indent by heading level, labels project the inline parse to clean text, the heading walk recurses into containers, and each entry is a button that navigates to its heading on click or Enter in every presentation mode. `tocPlugin({ maxDepth })` trims the outline, and `headingLevel` joined the authoring barrel.
- **highlight-occurrences** builds its word index once per edit and re-filters on a caret move instead of re-walking the whole document, and skips non-prose leaves through the declared `supportsInline` capability. Breaking: the export is now `highlightOccurrencesPlugin()`.
- **A `source` prop swap signals the decoration engine**, so occurrence marks and an open find bar no longer serve a document that has been replaced.
- **Strip containers reorder and copy through declared capabilities** (`reorderChildren`) rather than a hardcoded list/blockquote allowlist: reordering a child of a plugin strip container no longer teleports the whole container among document siblings, and a partial copy keeps its wrapper.
- **Fixes.** A non-advancing block opener could hang the parse loop in a production build, freezing the tab on a hand-typable document. A byte-corruption family closed at its seams: CRLF documents downgraded at the shared paragraph mint sites, cross-block inline paste desynced a container's ids and fired no edit event, indent, dedent and CRLF forward-delete could un-close a fence so the block absorbed the rest of the document on reload, and image alt escaping doubled backslashes on every commit. Inline recognizers now bound their declines rather than scanning to the end of the block, removing quadratic parse cost from bracket-dense and dollar-dense prose; the autolink delimiter prune and the wrapped-inline renderer shed their own quadratic and stack-overflow shapes.

### 0.9.34: emoji + native alerts + parity smalls

GitHub-parity extensions rode the surfaces the recent minors shipped. Every one is byte-preserving and uninstall-clean: an installed extension changes rendering, never the source.

- **Emoji shortcodes.** `:shortcode:` renders as an atomic glyph widget on a bare `:` rung priced above the directive text tier, so the two disjoint grammars coexist on one trigger and a table miss falls through byte for byte. The literal bytes stay in the raw, and the widget carries the atomic-delete, step-over-caret edge policy. A gemoji table is bundled, with no runtime or network dependency. Ships at `aragonite/plugins/emoji`.
- **Native GitHub alerts.** A blockquote whose first line is `> [!TYPE]` parses as its own `githubAlert` strip container, reusing the blockquote extent scan and the shared admonition chrome; the marker line lives only in the container's raw and metadata, and the bytes are never rewritten to `:::`. Breaking: with native rendering shipped, the admonitions paste transform is opt-in (`admonitionsPlugin({ convertAlertsOnPaste: true })`, default off), so pasted GitHub bytes stay GitHub bytes.
- **Two GFM-parity smalls.** Tilde runs of length 1 or 2 both strike per cmark-gfm, a run of three stays literal, and a mixed-length pair never matches. And GitHub's third math form, a fenced block whose info-string first token is `math`, parses as a distinct `mathFence` kind sharing the block-math render component; uninstalled it stays a lossless plain code block.

### 0.9.33: inline priority ladder + footnotes

- **Inline precedence overrides.** The scan stage consults a per-trigger rung list with published built-in anchors (`INLINE_PRIORITIES`), so a plugin recognizer can claim syntax beginning on a reserved trigger by registering a prefix rung priced below the built-in. `[` stays reserved against a bare registration, but a `[^`-prefix rung wins it wherever `[^` matches, and an unterminated `[^` declines back to the built-in link reading byte for byte. Rungs on one trigger dispatch by priority ascending, then longer prefix first, then lexicographic, independent of registration order.
- **GFM footnotes ship as `aragonite/plugins/footnotes`.** `[^label]: content` parses to an editable strip container: the marker paints as a dimmed ambient prefix on the first child, the body is real child blocks, and the container rebuilds its raw from the marker plus four-space continuation indents. `[^label]` is a first-class inline widget rendering as a superscript whose number derives from first-reference order, so an earlier reference typed elsewhere renumbers a widget live though its own block is never edited. The literal bytes stay in the raw, so round-trip and GFM portability are untouched, and a caret-adjacent destructive key reveals the source rather than deleting the reference whole.

### 0.9.32: latent fixes and plugin conveniences

- **Three latent bugs fixed.** The code block and non-reveal table cells prevented the native paste only after their first await, provably too late; a second pointer could end another pointer's drag on three of the four drag lifecycles; the task-checkbox strip left stale `ParsedLine` offsets on the public opener surface.
- **List overrides rejoined the shared delete and replace core**, regaining the noop-discard, focus-offset and backfill guards they had drifted away from.
- **Plugin surface.** `surfaceProps` on the editable leaf, so a consumer can no longer drop a handler; `getPresentationMode` on the container factory; and `containerClosure` beside `simpleLeafClosure`.

### 0.9.31: reported fixes, byte fidelity, cell parity

- **Reported fixes.** Enter in a setext title no longer demotes the heading and strands its underline as a junk block; split keeps a structural suffix with its block through a generic content-range rule at the split choke point. Focused whole-block blocks (thematic break, mermaid) and selected inline widgets copy and cut with Mod+C and Mod+X. Fence lines hide whole in reading and preview modes. The details disclosure caret centers on its summary line.
- **Byte fidelity.** Three CRLF defects closed: the trailing `\r` at the source slice, the interior highlighter mangle, and the all-blank reading collapse.
- **Caret and clipboard parity.** The post-paste caret honors the documented contract on all ten routes; range-delete survivors descend by focusability rather than merge-eligibility; cross-block type-replace re-derives the surviving leaf's kind; a copy during an active reveal reads the live DOM instead of stale raw.
- **Cells reach prose parity.** Decoration islands render and inline widgets reveal inside table cells through the prose seam's own machinery, behind a cell commit wrapper that escapes pipes and strips newlines.
- **Entities render.** `&copy;` shows © as an atomic inline widget, the first consumer of the `deleteGranularity: 'atomic'` policy, gated to visibly-rendering glyphs; lone combining marks stay literal-source spans.
- **Reload convergence.** An unclosed fence auto-closes when Enter-exit authors a block below it, so save-then-reload keeps the authored structure; the closed exit mints its new paragraph inside the fence's own container scope too.

### 0.9.30 — Simpler closure declarations for leaf kinds

- **`simpleLeafClosure` on `aragonite/plugin`** bakes the five structurally-fixed closure columns and requires the four the component determines, so omitting one is a compile error. The bundled toc, mathBlock and memo kinds migrated with their modes unchanged. Containers keep the full nine on purpose.

### 0.9.29 — Live reads become thunks

- **Breaking, plugin surface: the factory deps' live reads are functions.** `ContainerBlockDeps` and `EditableLeafDeps` replace their `node`/`index`/`path` getters with `getNode()`/`getIndex()`/`getPath()`, so passing a snapshot where the contract means "re-read live" no longer compiles. The rule the shape now carries: a function-valued field is a live read re-evaluated per use, a plain-valued field is static config.
- **CRLF fidelity.** Twelve sites reconstructed a trailing line ending as a bare `\n`, downgrading CRLF documents on code-block commands, cut, edge-policy deletes and reveal-fold; all now take the ending from the block's own raw.
- **Per-block opener context.** The parser mints a fresh `OpenContext` per block, so an opener that stashes it holds a stable object.
- **Core fixes.** The inline-content cache splits into per-signature-space slots, so interleaved resolver-less and resolver-ful callers no longer evict each other on every call; the CommonMark §6.6 tag grammar is single-sourced into the type-7 HTML-block opener.

### 0.9.28 — Corruption, conformance, keybinding and selection fixes

- **Corruption.** Indented-fence rendering corrupted bytes on load-then-type; a typed `|` in a table cell shifted or silently dropped cell content on reload; a stale render key let undo be silently re-reverted after a kind flip; cross-block inline paste left a stale kind over new bytes; a clipboard action during a widget reveal spliced at stale offsets and muted subsequent typing; CRLF documents normalized on details, mermaid and directive rebuilds and on the first keystroke.
- **GFM conformance and parser robustness.** List items absorb lazy continuation lines, and list-exit mints the blank-line separator its output needs on reload; `www.` autolinks gain their scheme; link-reference definitions reject trailing garbage and yield to block openers; indented code interrupts non-paragraph predecessors; entity-shaped autolink tails are excluded; container nesting depth caps at 512 with byte-preserving degradation, where roughly 2KB of input used to reach a stack-overflow crash; the backtick and directive-closer scans gained their siblings' bounds, retiring two super-linear shapes.
- **Keybinding routing.** A malformed chord fails loudly at every ingestion path, so a `Ctrl+W` typo no longer silently steals every `w`; the container bubble honors consumer global disables; document-level chords gate on instance containment, so a multi-editor page routes to exactly one editor and a sole editor yields Ctrl+F to a foreign text input.
- **Selection.** Same-path cross-block state is unmintable, closing the invisible-selection class; backward-selection entry captures the anchor rather than the range start; a full-column delete tolerates windowed-out rows; `getSelection()` reports real within-block range offsets; table Shift+Arrow extension walks rows and exits the table.

### 0.9.27 — Typed unions and per-instance grammar

- **`SelectionPoint` is a discriminated union** (`CharSelectionPoint | CellSelectionPoint`, on the `cellCoordinate` flag). `offset` keeps its name on both variants, so a consumer reading it stays near-source-compatible, while cell mints carry construction teeth and the undo copy path preserves the variant.
- **`CstNode` is a discriminated union**, with per-built-in-kind arms and typed metadata behind `isBuiltinBlockNode` plus an open branded-plugin arm. A kind change now mints and replaces the node rather than writing `kind` in place; same-kind edits keep in-place field writes, because node identity is load-bearing for the block-list registry, the height caches and the inline accessor.
- **Registry reads resolve through per-instance views over global definitions**, so two editors in one process can render a plugin kind differently, and `parse` gained an additive `{ grammar }` option threaded through the content-commit reparse. Under a dev server a duplicate registration now replaces with a note instead of throwing, so a re-evaluated registrar survives; production and test keep the register-once throw.

### 0.9.26 — Presentation modes: the full live-preview ladder

Always-visible styled source stays the editing substrate and the default; these modes make it a choice rather than a ceiling. A plugin can learn the presentation mode at every tier, so nothing authored against 1.0 strands when a consumer flips to preview.

- **The mode contract.** `PresentationMode = 'source' | 'reading' | 'preview-block' | 'preview-inline'`, a live `presentationMode` prop reflected as `data-presentation` on the root, and one effective-mode resolution feeding four doors: the root attribute, a block-facing context getter, `EditorContext.presentationMode` plus a `presentationModeChange` event, and getter reads on the editable-leaf and inline-widget tiers.
- **Reading mode** hides markers, renders widgets, and is read-only. Hiding is CSS-first, so raw offsets survive by construction. Read-only is structural: `contenteditable=false` kills the whole browser-edit-path class, with paste, command, drag, island and checkbox gates at their dispatcher seams. Selection, copy and mouse or scroll navigation stay, and lists keep rendered bullets and visible ordered numbers.
- **Block-granular preview** hides syntax on unfocused blocks while the focused leaf renders full source, at zero hot-path cost: focus flips are CSS attribute changes, never inline-DOM rebuilds, and the caret's DOM anchor survives the reveal so click landing needs no correction.
- **Inline-granular preview** hides construct markers (emphasis, strong, strikethrough, inline code, links, image syntax) within the focused block until the caret enters the construct's range; entry reveals the full nesting chain and leaving folds it. The trigger is model-layer and composition-gated, with a synchronous keydown backstop so rapid arrows cannot outrun the reveal and skip hidden bytes.
- **Caret affinity turned out to be unnecessary.** The caret is a raw offset, revealed source makes boundaries visible, and typing lands where the visible caret sits, with right-prefer deciding which construct reveals at a shared boundary.
- **The caret-edge and destructive-key seams consolidated** into one declarative edge-policy dispatch, with the trimmed `deleteGranularity` and `onEdge` policy fields re-added.

### 0.9.25 — Inline observability

- **The interaction trace.** A ring buffer of inline-layer transitions: rebuilds and which render-key segment changed, cursor capture, restore and pending, reveal open and fold with reason, widget-pool adopt, build and sweep counts, composition start and end, island applications, sticky capture and reset. It ships in production default-off behind one boolean per site, so a real app can arm it, and entries carry primitives only, never document text.
- **Two doors.** The debug panel gains an inline trace section, and consumers get `getDiagnostics()` on the editor instance: trace enable and snapshot plus `serializeDiagnostics()`, an attachable fenced-markdown field report with the document source excluded by default (`includeSource: true` is the consumer's explicit call). The trace is process-global, so two editors interleave.

### 0.9.24 — Enforcement hardening: the load-bearing contracts climb to types

- **Breaking, plugin surface: registration carries a required `closure` block** answering all nine cross-cutting systems as implemented, inherit-default or not-supported; a blank cell is a compile error, and a `conformanceFixture` rides the declaration. The `aragonite/testing` kit generalized so that registering a kind enrolls it: headless cells (round-trip, merge, clipboard, undo) execute at the unit gate, a profile custom check is refused on a cell not declared implemented, and a browser sweep executes the three mounted-DOM columns per registered kind.
- **Readonly-by-layer CST views.** `NodeView` and `DocumentView` are bytes-scoped deep-readonly views: serialized bytes are readonly, the id and epoch bookkeeping stays writable. Components, the decorations engine and the entire plugin surface (`EditorContext.document`, `DecorationSource.provide`, `BlockComponentProps`, descriptor read hooks) read through views; constructors and writers keep the mutable type. Every in-repo consumer compiled unchanged.
- **Branded coordinate spaces.** Raw offset, ambient-inclusive DOM-text offset, editor-relative X, viewport X, cell index and doc-absolute path are distinct branded types minted only by their single-home modules, with inter-space conversion a named function with one home per direction; public doors keep `number` and brand once at the boundary.

### 0.9.23 — Demo groundwork: bundled plugins ship as package subpaths; `/` is the showcase

- **First-party plugin packaging.** The bundled tier (admonitions, details, latex, mermaid, toc, highlight-occurrences) ships as `aragonite/plugins/<name>` subpath exports: one version, one tarball, exports-map encapsulation.
- **Engines stay out of consumer bundles.** latex and mermaid split into engine-free cores and `/renderer` adapter subpaths. `aragonite/plugins/latex/renderer` is katex-backed and carries the one sanctioned CSS side effect; `aragonite/plugins/mermaid/renderer` dynamic-imports mermaid. `latexPlugin({ renderer })` requires its renderer, since math has no honest engine-free fallback, while `mermaidPlugin()` stays legal and renders the fenced source statically. katex and mermaid became optional peer dependencies.
- **`getContentRange` joined the plugin barrel.**
- **The `/` showcase route** mounts the editor with all six bundled plugins over a document covering every built-in block kind. `/test/*` is uniformly machine-facing: the `?plugins=1` toggle retires, and `/test/editor` always renders the plugin-free default.

### 0.9.22 — Decorations + the public rect API: the extension surface completes

Decorations, view-only annotations over content a plugin does not own, were the one plugin class the platform could not express, and the public rect API they bottleneck on had no consumer door either. Both ship here.

- **The engine.** A decoration source is a pure `doc → Decoration[]`, memoized, with no state API and nothing to map forward. One edit epoch splits the two invalidation reasons: `notifyEdit` bumps the epoch and re-runs every source because the document changed, while a source handle's `invalidate()` re-runs just that source because its own state changed. Each source runs contained, so a throw keeps its prior decorations and surfaces as an attributed error rather than blanking the view.
- **Four types, tiered paint.** `mark` (a positioned overlay per visual line carrying the source's class), `widget` and `replace` islands (in-flow, applied in the prose render path), and `block` (whole-block). A mark whose range crosses dimmed markers, soft wraps or ambient spans splits into one rect per fragment.
- **Island editing semantics.** An in-flow widget or replace island defines caret and delete behavior at its boundaries; an island targeting a non-prose block warns in dev at the source seam instead of silently rendering nothing.
- **The public rect facet, on both doors.** `editor.getRects()` for consumers and `editor.rects` for plugins return viewport-space geometry: a block's box, an inline range's rects, and the partial-rect split, which is the geometry a suggest popup or a selection toolbar needs.
- **Search migrated onto the engine** as its first client, and the bespoke match overlay retired.
- **A childless opaque container now paints decorations**, where its endpoint box had been invisible to the partial-rect walk.
- **Barrel.** The `Decoration` union, `DecorationSource`, `DecorationSourceHandle`, `DecorationRegistry` and `EditorRects` joined the public barrel and the plugin subpath.

### 0.9.21 — The plugin context spine: per-instance editor handle

`setup()` took no arguments and ran once per process, so a plugin could reach no editor: no derived state, no edit reaction, no per-instance config. The context spine closes that class.

- **`setup(ctx)` and `onEditor`.** `setup` receives a `PluginSetupContext`; `ctx.onEditor(cb)` registers a per-`<Editor>` callback receiving an `EditorContext`: `editorId` stable per mount, a live `document` getter, a subscribe-only `events` view, and typed `options`. The callback may return a disposer run at unmount. Registration is synchronous-only, and `definePlugin` gained an `<Options>` generic so `editor.options` reads typed with no cast.
- **Per-instance options.** The `plugins` prop accepts a bare unit or `{ plugin, options }`, so two editors sharing one process-global registration can still run different options.
- **`registerGlobalCommand`** mints a process-wide command whose handler receives the dispatching instance's `EditorContext`, so an editor-scope action fires regardless of focus. An optional chord binds in the plugin-global tier, which resolves last; built-in and search chords are unstealable, and a collision throws before the mint. A handler throw is contained as an `error` of origin `command`, attributed to the owning plugin.
- **`BlockCommandContext.editor`** gives a block command the same `EditorContext`, and **`BlockComponentProps.document`** gives every block component the read-only root document at any nesting depth, so a table-of-contents block can see the headings above it.
- **`estimateHeight` descriptor field**, an optional O(1) per-kind height estimate the oracle consults after the collapse probe, so a diagram is estimated at its skeleton height and scroll is right before it mounts.

### 0.9.20 — Plugin-platform hardening

- **Contract ambiguities closed.** `augmentBlockKind` gained an ownership gate, so a plugin can no longer silently overwrite a sibling plugin's kind descriptor. Minted block commands now dispatch on the plugin editable-leaf tier through the same seam as the container-bubble path, where they had been a silent dead key. A `'command'` error origin contains a throwing plugin handler at both dispatch choke points, so it becomes an attributed error event rather than an uncaught window error.
- **New `aragonite/testing` subpath** with one env-guarded `resetPluginPlatformForTests()` aggregate, so third-party authors get the isolation the in-repo tests always had.
- **The command-to-component channel**, the top recorded authoring wall: a factory-level `commandHooks` getter threads plugin UI hooks into `BlockCommandContext.hooks` on both tiers, with no node-keyed map and no lifecycle cleanup.
- **Authoring conveniences.** `createBoundedMemo` (one signature unifying sync clone-on-read and async promise or rejection caching) joined the barrel, and `createDirectiveRebuild`, `chromeChild` and `definePluginBlock` cut the copied rebuild, title-child and registration ceremony.
- **Folklore became contract.** `OPENER_PRIORITIES` is exported and single-sourced, with built-ins registering from the constant so drift is a compile error, and the theme-token manifest is published with a both-themes existence guard.

### 0.9.19 — Selection and focus completeness

- **A childless opaque container inside a cross-block selection paints the full-block overlay.** The container gate deferred painting to child hosts that do not exist for a childless plugin block, so a selected diagram showed nothing.
- **The error, loading and no-renderer diagram states are no longer caret traps.** Each non-rendered steady state mounts a focusable surface, with a choke point falling back to the block's box so no future plugin render state can strand the caret; committing a source fix from the error card hands focus across the async card-to-viewport swap.
- **The range-delete ceremony unified at one choke point.** The table branch emptied covered containers child by child before deleting them, corrupting any undo snapshot holding the detached node.
- **Structurally-noop commits no longer mint dead undo entries or events**, while metadata commits that legitimately no-op still commit.
- **Directive rebuilds preserve CRLF**, the authored line ending riding directive metadata.

### 0.9.18 — Caret-entry UX: widgets reveal, opaque blocks focus

- **Horizontal caret entry into a reveal-capable inline widget opens the source reveal.** ArrowLeft or Backspace from the right, ArrowRight or Delete from the left of inline math and directive text widgets reveals the raw source with the caret at the entered edge, and walking out folds it. This replaces the widget-selected park, a state with no visual rendering for math, where the caret vanished and a second Backspace silently deleted the whole formula. Images keep select-then-step and select-then-delete, and Shift+Arrow extension never reveals.
- **Opaque childless plugin blocks are whole-block focus targets** through a `blockFocus: 'whole-block'` descriptor plus a focus-element getter on the container factory. Arrows stop on the block with a focus highlight instead of gliding past; Backspace at the start of the block below, or Delete from above, focuses it first and a second press deletes in one undoable commit; Enter inserts a paragraph below; Alt+Arrow reorders; keys from the plugin's own edit textarea never reach the block affordances. Previously such a block was undeletable except by selection sweep.
- **The editable-container backfill no longer stuffs a phantom paragraph into childless-by-design kinds**, which had violated the opaque raw-to-children faithfulness on every load.

### 0.9.17 — Editor fixes and showcase quality

- **Editor fixes.** Enter at content offset 0 splits instead of doing nothing (text kinds) or corrupting bytes (the fenced-code opener). Opaque plugin containers decline nested reorder, so dragging an inner block no longer teleports the whole container, and chrome rows carry no dead drag handles. The multi-scope commit no longer rebuilds or checks scope nodes its own mutation detached. KaTeX renders once, with its stylesheet documented as the consumer's responsibility. An inline-widget reveal folds on caret escape, with a pointerdown-owned click gesture, boundary-inclusive containment and one-gesture widget switching.
- **Showcase quality.** Admonitions and details moved to restrained gutter-rail chrome with the untitled-title wrap fixed; mermaid gained focused-only zoom and pan, double-click edit, Tab-as-indent, and a theme-token toolbar and overlay.

### 0.9.16 — The editable-leaf tier

- **`createEditableLeaf` on `aragonite/plugin`** is a text-editing plugin block with native caret, IME, undo and cross-block-selection parity, the container factory's sibling for leaves. Two modes: `plain` (always editable, per-keystroke commits, prose undo batching, factory-owned view sync) and `render-primary` (component-owned render-to-source swap, where the whole reveal, edit and blur cycle is one undo entry). It returns the `BlockComponent` surface pre-guarded for one-line re-exports, the source-element handlers, `reveal` and `commitSource`. Block math migrated onto it and crossed the package boundary.
- **The stuck-fence class, killed at the choke point.** A block whose edited text parses to multiple blocks now structurally replaces itself with all of them: the first keeps its slot identity, and the caret follows the edit position into whichever block it falls in. The old cram wrote multi-block text into one node's raw, which built-ins could reach too (a paragraph hard break plus an interrupter line, a fenced-code early close), so the fix landed at the tree-op choke point and both commit bodies rather than in the factory.
- **`KeybindingOverride.kind` widened to `AnyBlockKind`**, so a consumer can scope a chord to a plugin kind through its exported kind constant.
- **Barrel additions.** The CommonMark fence matchers `matchFenceOpen` and `matchFenceClose`, now capturing the verbatim indent and info bytes a byte-exact rebuild needs, and `normalizeLineEndings`.

### 0.9.15 — Mermaid reference plugin

- **The first reference plugin**, a `mermaid`-fence diagram block written as a first adopter would write it with every import from `aragonite/plugin`, validating the render-primary recipe for blocks whose content renders as a picture rather than as text. A fence-claiming opener priced ahead of `fencedCode`; an opaque container with no children whose code and fence bytes live in typed plugin metadata, with `rebuildRaw` re-emitting the exact bytes; edit mode as a plugin-owned textarea committing through the container factory as one undoable, byte-exact entry. The renderer is injected (`mermaidPlugin({ renderer })`) and memoized per code text, parse failures render a legible inline error, and absent a renderer the block shows its code statically. Pan and zoom on the rendered SVG plus a fixed-position focus overlay, with a minted `mermaid.focus` command on `Mod+M`, prove interior interactivity inside the component's own DOM.
- **Uninstall safety is by construction:** without the plugin the same bytes parse as plain `fencedCode`, pinned by an adversarial round-trip property over fence shapes in both install states.

### 0.9.14 — Component-portal inline widgets

A plugin can supply a Svelte component as an atomic inline widget instead of hand-building DOM, made churn-safe under the editor's per-keystroke render by a keyed reuse pool.

- **The `component` descriptor field.** `registerInlineWidgetKind` accepts a `component`, mounted with frozen `{ inline, source }` props, as an alternative to `buildWidget`; declaring both throws, naming the kind. The render layer wraps the component in the atomic island, stamping the marker attributes the cursor and selection machinery key on, and mounts it through an injected portal builder so the core stays framework-free. `InlineWidgetComponentProps` is on the `aragonite/plugin` barrel.
- **The keyed reuse pool.** One live instance per `(kind, source)` survives a block's per-keystroke rebuild, so typing next to a widget adopts its instance rather than remounting it, and an instance is remounted only when its source text changes. A synchronous mount throw is caught and routed to the editor's `error` channel with `origin: 'render'`, the widget falling back to its raw source.
- **KaTeX inline migrated as the validator**, rendering through a component instead of the hand-built shell.

### 0.9.13 — The plugin unit + paste conversion config

- **`definePlugin` and the `plugins` prop.** `definePlugin({ name, setup })` packages a plugin's global registrations, and the editor's set-once `plugins` prop installs each once per process, before the instance's first parse. `installPlugins` is the editor-less entry for `parse()` pipelines, and `isPluginInstalled` probes an install. Semantics: once per process keyed by name, same-identity re-install no-ops, same-name different-identity is first-wins with a dev warning, and a failed setup stays failed. Kind declarations made during a setup are attributed to their plugin, so a duplicate-registration error names the first declarer.
- **The bundled extensions became factory exports** (`calloutPlugin()`, `detailsPlugin()`, `latexPlugin({ renderer? })`, `admonitionsPlugin()`), each installed through the prop. Per-plugin config rides the factory and the unit owns idempotence, so the per-call registration guards left the authoring model.
- **Content-keyed paste transforms.** `registerPasteTransform` records a named, pre-parse rewrite of pasted plain text, run in install order at every paste site, each declining or replacing the clipboard text before the parse. Paste-scoped and content-keyed, attributed to the owning plugin, with a dev warning on a non-idempotent transform to catch paste feedback loops.

### 0.9.12 — The admonitions extension and the published plugin guide

- **Admonitions shipped as a reference extension**, built by a walled-off author with only the packed tarball and the public docs: five directive kinds, editable titles, per-kind styling, an undoable kind-switch chord, GitHub-alert conversion, and byte round-trip including the plugin-uninstalled fallback.
- **`docs/guide/plugin-guide.md` is the published authoring entry point**, covering every barrel export and shipping in the docs pack. `isDirectiveRegistered` joined the public probes.
- **`registerPasteSurface` stays unexposed**, rejected with evidence: the target-kind-keyed hook cannot serve content-keyed pre-parse conversion, and its type closure would drag commit-coordinator machinery public.

### 0.9.11 — The `:::name` directive primitive

One shared opener owns all `:::`, `::` and `:` fences and dispatches by name into the editor's kind system, so N plugins never collide on opener priority.

- **Three tiers, one grammar.** Container (`:::name … :::`, nested block children), leaf (`::name`, single-line block) and text (`:name[label]{attrs}`, an atomic inline widget with source reveal on focus). Colon count is the tier boundary, and container nesting uses fence length like fenced code.
- **Dispatch by name, lossless fallback.** A registered `(tier, name)` resolves to the plugin's own first-class kind with full descriptor power; an unregistered name round-trips byte for byte through a generic fallback kind and renders generically, so a document survives its plugin being uninstalled.
- **Public activation.** `activateDirectives()` on `aragonite/plugin` is an explicit, idempotent, call-based activation, so a barrel import alone never claims `:::`. `parseDirectiveAttributes` is an opt-in `[label]{attrs}` reader, and the authoring guide is `docs/guide/directives.md`.

### 0.9.10 — Inline-widget editing registry + KaTeX

- **`AnyInlineKind` widening.** Plugin inline kinds thread through the model, mirroring `AnyBlockKind`, with an unknown-inline fallback; `registerInlineWidgetKind` and `augmentInlineWidgetKind` carry per-kind editing policy.
- **The inline-syntax recognition hook.** `registerInlineSyntax` hands the scanner a trigger character and a recognizer, gated so it stays dormant unless registered and conformance stays byte-identical.
- **A shared source-reveal editing primitive.** Atomic inline widgets contribute raw bytes through `data-source-start` and `-end`, are caret-addressable only at their edges, and reveal editable source on focus.
- **A first-party KaTeX extension.** Inline `$…$` (select, then reveal source) and block `$$…$$` (render-primary, source on focus), with the renderer injected rather than bundled and verified out of `dist`. `deleteGranularity` and `onEdge` were trimmed as unconsumed, to be re-added additively with a real consumer.

### 0.9.9 — Inline scanner rework: the CommonMark delimiter/bracket-stack pass

`parseInline` became a single left-to-right scanner: character dispatch feeding a delimiter stack (flanking, `openers_bottom`, original-run-length multiple-of-3) and a bracket stack (innermost-wins links, spec destination and title parsing). The staged pre-pass pipeline is deleted.

- **Deliberate-only conformance.** The divergence baseline against commonmark.js went from 71 entries in 11 classes to 9 in 3, each with a recorded reason: astral flanking, GFM bare autolinks, and image alt as raw label bytes. Six classes converged outright, and no previously-agreeing input regressed across the full corpus.
- **The 0.9.6 inline stopgaps retired structurally**: the link-in-code-span corruption class and the delimiter-rule patches are unrepresentable in the stack architecture.
- **Roughly 2.2 times faster** than the old pipeline over the slice corpus.

### 0.9.8 — Registry hardening

- **Breaking, plugin surface: container-only descriptor fields register as one `container` unit** (`BlockKindRegistration`), with `rebuildRaw` required inside the group, so the container-without-rebuild pairing is structurally unrepresentable. Both write seams also strip container-only keys from widened flat objects, closing the structural-typing escape the type pins cannot see.
- **Registry coherence moved to the registration seam.** Per-registrant checks flush at mount or the next grammar read rather than in a startup sweep, so intra-batch forward references stay warning-free, and an opener registered after documents have parsed warns in dev, naming the kind. Late registration stays legal.
- **Opener dispatch order is a pure function of declarations** (`priority`, then kind), so module load order can never matter; equal priorities still warn as name-arbitrary.
- **Coherence derives from live registries.** A plugin keymap's command ids validate against minted `PluginCommandId`s, and a `reservedChrome` declarer must be a container whose chrome kind resolves to a registered descriptor and component.
- **`ContainerBlockListProps` inverted** into an authored contract with a two-direction compile-time conformance check, so an internal prop edit fails at the contract instead of silently rewriting the public shape.

### 0.9.7 — Command mint: plugin block-commands + registry fail-loud

- **`registerBlockCommand(kind, name, handler)`** on `aragonite/plugin` mints a branded `PluginCommandId` and registers a `(kind, id)` handler; `AnyCommandId` threads plugin ids through the keymap, override and dispatch types. `BlockCommandContext` and the handler shape joined the pre-freeze plugin surface. The `:::note` callout gained a `callout.setKind` command bound to `Mod+7` and `Mod+8`, validating mint through keymap, bubble dispatch, handler and metadata commit end to end.
- **Bubble dispatch single-sourced.** `dispatchKindCommand` is the one seam every container-bubble keydown routes through, resolving the registry and otherwise the container's `runCommand`; the built-in list, blockquote and table containers migrated onto it.
- **Two registry fail-loud fixes.** `registerInlineWidgetKind` throws on a duplicate, so a plugin can no longer clobber the built-in `image` and `rawHtml` widgets process-globally, and `augmentBlockKind` rejects built-in kinds, closing the silent built-in-descriptor-rewrite path.

### 0.9.6 — Corruption fixes, path-dialect unification, contract quick-wins

- **Selection across tables no longer corrupts the CST.** Table-endpoint normalization moved inside the selection state, closing two hand-reachable corruption gestures: a double Ctrl+A with a table at a document edge, and a shift-click between paragraph and cell. Shift+ArrowUp from a container's first leaf no longer extends downward, cross-block delete holds a re-entry latch, and table endpoints join the multi-scope commit so whole-row snaps keep row ids stable.
- **Inline parser stopgaps.** A link destination can no longer terminate inside a code span, a typable byte corruption; the emphasis multiple-of-3 gate reads original run lengths; bracket nesting is depth-capped; entity and paren scans are bounded; a GFM header and delimiter count mismatch rejects the table per spec instead of silently truncating header cells.
- **One path dialect on the public event channel.** Commit scopes mint doc-absolute event and undo-snapshot paths at the seam, so nested ops no longer emit scope-local paths, no-caret undo restores land for click-driven container ops, and typing in a container-nested link-reference definition rebuilds the resolver map. Landed pre-freeze on purpose, since the `edit` channel is what external consumers bind to.
- **Plugin contract quick-wins.** `parse`, `serializeChildren`, `trimTrailingLineEnding`, `declaredPluginKind`, typed `BlockComponentProps` and `ContainerBlockComponent`, and registry probes for kind, component and opener joined `aragonite/plugin`; collapse-ness is single-sourced from the declared probe, so the window clamp and height oracle derive from it; `KeyBinding.arg` widened for the coming command mint; the uncallable `registerCommand` export was removed until the mint landed.
- **Interaction and accessibility fixes.** Focus and reveal skip failed-render blocks instead of hanging; keyboard reorder works for code blocks and thematic breaks; table alignment restores focus and announces; Ctrl+F works with CapsLock; structural paste lands the caret at the end of pasted content; pasted unordered items adopt the destination list's bullet on every paste route; case-insensitive search is fold-safe and a new query starts at the first match.
- **Theming made real.** The eleven documented `--syntax-*` tokens are now actually read, visually neutral by construction, so consumer overrides work without changing the shipped look, and undeclared token reads are fixed.

### 0.9.5 — Details/collapsible: the second chrome consumer + first-class collapse

- **The `<details>` kind** claims a narrow canonical form ahead of the htmlBlock opener, with non-canonical HTML declining back to it, the summary as a chrome child, and `open` metadata round-tripping `<details>` and `<details open>` byte for byte.
- **Collapse is a windowing clamp.** A collapsed container renders only its chrome row through the existing windowing machinery, so the body genuinely unmounts and O(viewport) is preserved, and a reveal into a collapsed body degrades to the summary without editing the document.
- **A declared collapse probe.** `reservedChrome.isCollapsed` on the container descriptor makes every child-adjacency operation collapse-aware as a class: merge-from-below stops at the chrome instead of writing into the hidden body, arrows exit the summary, and Enter cannot mint invisible paragraphs.
- **Chrome and tables compose.** Cross-block ranges involving tables inside a chrome container's body honor the chrome wall, clearing rather than deleting.
- **Clipboard.** A cross-block copy ending mid-title or mid-summary emits reparseable container bytes through the kind's own raw rebuild over a synthetic chrome node.

### 0.9.4 — Plugin authoring: containers, editable chrome, the reserved-chrome contract

The first real plugin-authoring surfaces, exposed pre-freeze on the `aragonite/plugin` subpath.

- **Container authoring.** `createContainerBlock` wires a nested plugin container (list state, ancestor contexts, nested actions, windowing, the `BlockComponent` surface) in one factory, so a plugin container is as thin as the built-in blockquote. Typed plugin metadata accessors and idempotent-registration probes ship with it.
- **Editable chrome.** `registerChromeLeaf` registers a container's editable title or summary leaf in one call, with a default keymap where Enter descends to the body and chord-keyed caller overrides. `contextDependentKind` makes recognizer-less kinds keep their kind through content edits, and `containerContract: 'opaque'` names containers whose raw is authoritative rather than a strip decomposition.
- **The reserved-chrome contract.** A container declares its chrome slot through `reservedChrome` and the machinery enforces it: always present, since backfill re-mints the chrome kind; single-line and unsplittable; cleared rather than node-deleted by cross-block ranges, so nothing merges raw across the container boundary; and kind-stable.

### 0.9.3 — Library packaging + external consumer harness

The editor became an installable package, proven from outside the repo.

- **Packaging.** A `svelte-package` build with an `exports` map covering the component barrel, the `aragonite/plugin` subpath and the theme CSS; `svelte` as a peer dependency; the dist pruned of test files; a verified `npm pack` artifact.
- **External consumer harness.** A durable `examples/consumer` app installs the packed tarball rather than `$lib` and imports only public entry points; the editor server-renders and hydrates cleanly.

### 0.9.2 — Table mouse affordances

Pointer and contextual-menu editing for tables, pairing with the keyboard chords so table editing is no longer keyboard-only.

- **Hover grips and drag reorder.** Hovering a row or column reveals a grip, and dragging it reorders that row or column, with a single insertion line, autoscroll to reach off-window rows and wide-table columns, and one commit on release.
- **Contextual menu.** The grip menu and a right-click on any cell open the same menu: insert and delete row and column, left, center and right column alignment, and cut, copy and paste for a cell. It also opens from the keyboard through Shift+F10 or the Context Menu key, with full arrow, Home, End and Escape navigation and screen-reader announcements.
- **Keyboard column reorder.** Alt+←/→ moves the focused column one slot, mirroring the Alt+↑/↓ row reorder.
- Two caveats: menu Cut and Copy write rendered cell text rather than the keyboard path's raw-source slice, and menu Paste depends on `navigator.clipboard.readText()`.

### 0.9.1 — Pre-1.0 polish: theming for extraction, consumer docs, hygiene

- **Theming scoped for extraction.** All tokens moved off `:root` to the editor's own scope (`.editor`, plus an opt-in `.aragonite-editor-theme` class for non-editor chrome), so the module no longer injects custom properties into a consumer's global scope and a consumer themes the editor through one channel. Light and dark key off a `data-editor-theme` attribute driven by a new `theme` prop (`'dark'`, `'light'`, or a custom name), and the `--color-*` chrome tokens gained light and dark defaults, so the search bar, image and code backgrounds render correctly in both modes with no host.
- **The consumer guide completed**: the `getSearch()` controller and `searchBar` prop, the named CST utilities (`parseInline`, `getContentRange`, `isProseKind`), the `EditEvent` and `EditorError` payload envelopes, a minimal mount example, and the theming scope, toggle and override contract.
- **Hygiene.** Dimmed-marker opacity tokenized as `--syntax-marker-dim`; code and mono surfaces unified on `--font-editor`; list indent and promote adopt the destination bullet glyph within the unordered axis.

Internal only.

### 0.9.0 — Remaining GFM + public API

- **Angle-bracket absolute-URI autolinks.** `<scheme:…>` for any valid scheme (`<ftp://…>`, `<mailto:…>`, custom) now autolinks, generalizing the former `http(s)`-only recognition to the CommonMark absolute-URI grammar and closing the one §6.8 gap.
- **The `keybindings` prop.** A per-instance override map rebinds, adds or disables bindings over the built-in command vocabulary without forking, consulted ahead of the built-in keymaps at every dispatch site. It flows through context rather than module-global mutation, so two editors can carry different bindings, and the full `CommandId` vocabulary and the chord format are exported as public types. Undo and redo chords are overridable too, which also fixed a loose key check that mis-caught Ctrl+Alt+Y as redo.
- **Public API truthfulness.** `EditorSelection` and a named `EditorInstance` handle are exported, and `EditorProps` is single-sourced so the component consumes its own published type and cannot drift.

### 0.8.10 — Perf attribution + flat-shape gate

- **The flat keystroke is O(viewport).** The apparent high-block-count keystroke residual turned out to be a harness artifact rather than editor cost; attribution confirmed windowing fully bounds the keystroke.
- **The sticky-navigation scan is bounded.** Finding the offset nearest a pixel column scanned every offset in the block; it now scans only the probed visual line's neighborhood, so sticky Up and Down through a giant paragraph no longer measures a rect per character.
- Two limitations accept-documented in `docs/design/performance.md`: the intra-block single-giant-paragraph keystroke, an O(paragraph-length) span rebuild that is synthetic and transient since Enter splits the paragraph, and flat load, an O(node-count) reactive-tree materialization that is sub-second at realistic sizes.

Internal only.

### 0.8.9 — Editor quality pass

- **Keyboard table-row reorder.** Alt+↑/↓ inside a cell moves the focused body row one slot among the body rows, as one identity-preserving structural reorder and a single undo entry, with focus following the row in its column and a live-region announcement. The header row is positionally fixed, and a boundary press is a no-op.
- **Find/replace polish.** Undo after replacing nested content restores the caret to the exact nested leaf rather than the top-level block, and a zero-width regex match no longer paints an invisible highlight sliver.
- **Default link activation hardening.** The default link handler is policy-gated through the scheme allowlist, so a host that supplies no `onLinkActivate` will not open a `javascript:` or control-byte URL.

Internal only.

### 0.8.8 — In-document find/replace

Find and replace within a document: a toggleable top-right floating bar plus a public engine API. Search is a read-only lens over the CST, so scanning and highlighting never mutate the tree, parser or inline cache.

- **Engine.** A pure module scans editable leaves for matches (case, whole-word and regex toggles, with `$1` capture refs and an invalid-pattern error state), keyed by block path. Container raw and ambient prefixes are never scanned.
- **Highlighting.** A per-block overlay paints matches through the existing partial-rect hook, so windowing bounds highlight cost to the viewport; table cells paint as whole-cell highlights.
- **Replace.** Per affected top-level subtree, the substituted source is reparsed and committed as one identity-preserving replace batched into a single undo entry, so cost is O(affected) and untouched top-level blocks keep their identity. Table-cell replacements escape `|` and newline so a row cannot be split, and regex replacements expand `$1`, `$&`, `\n` and `\t`.
- **Bar and API.** The `searchBar` prop (default on) renders the built-in bar, with Ctrl+F for find, Ctrl+H for replace and Escape to close and restore focus; `editor.getSearch()` exposes the controller so a consumer can disable the bar and drive a custom UI. Re-scan runs only while the bar is open, deferred off the keystroke path.

Internal only.

### 0.8.7 — Block reordering

Move a block among its siblings (top-level blocks, list items within their list, a blockquote's children) over one structural reorder operation reachable two ways.

- **Keyboard.** Alt+↑/↓ nudges the focused block past a sibling, with a screen-reader announcement of the new position. Always available.
- **Mouse drag.** A hover handle, revealed on the innermost reorder host only, drags the block; a ghost follows the pointer and a single insertion line marks the drop gap, with no mid-drag reflow and one commit on release. Escape or pointer-cancel aborts cleanly. Consumer-toggleable through `blockDragHandles`, default on.
- **Off-window targets via autoscroll.** Drops hit-test against mounted siblings, so a target below the fold is reached by holding the pointer near the viewport edge to autoscroll it into the window. There is no precise off-window drop; this is the intended reach for large windowed documents.

### Post-0.8.6 hardening

- **Cross-block table selection.** A whole-row snap at the selection-normalize choke point makes highlight, copy and cross-block delete agree on a mid-row table endpoint, closing a Cut data loss; pointer-drag endpoints carry cell coordinates like the keyboard path.
- **Commit rollback.** A throwing container or multi-scope commit restores each scope's pre-mutation children, so the live tree is never left partially mutated.
- **Editor-root keystroke routing.** When the caret's block is windowed out and native focus drops to the document body, a document-level listener routes cross-block and undo/redo keystrokes, closing undo and redo being inert while unmounted.
- **Forward delete and list markers.** Nested code-block forward delete uses a focus-layer move-or-noop instead of a root-versus-container index mismatch, and ordered markers adopt the destination punctuation on indent and promote.
- **Per-instance state.** The image broken-URL cache is per editor instance, and the "global schema, per-instance state" contract is documented for consumers.

Internal only.

### 0.8.6 — Virtual rendering (windowing)

Mounted block components are bounded to the viewport at every nesting depth, turning steady-state keystroke cost from O(mounted) to O(viewport). Design record: `docs/design/virtual-rendering.md`.

- **Top-level windowing.** The block list self-activates on hysteresis watermarks, rendering a sliced window between top and bottom spacers so native scrollbar geometry stays real. A per-kind height oracle, an O(1) raw estimate replaced by measured height cached by stable id, feeds an index-to-offset model, and a reveal primitive scrolls off-window focus, caret, undo and selection targets into the window and awaits their mount before acting, with the focused block pinned mounted.
- **Recursive container windowing** extends into blockquote, list-item and long-flat-list scopes, with a list or table windowing its own children directly; measured heights propagate upward through two passive index-keyed channels.
- **Table-row windowing.** A giant table windows its rows, reusing the shared wiring wholesale; the row-to-cell path descent also closed the gap where a cross-block command could not reach a table cell, and the pass fixed a chain of pre-existing table cross-block selection bugs.
- **Pressure-test hardening.** Width and resize invalidation, manual scroll-anchor correction, the scope-owned batched measure pass, bounded reveal, off-window vertical transparency, per-scope width estimates, and sticky-column geometry from the first mounted row.

Internal only.

### 0.8.5 — Lazy `inlineContent`

The inline tree, a derived rendering cache, moved from eager to cost-on-read, so inline cost is O(viewport-rendered plus on-demand-touched) rather than O(document).

- **Cost-on-read accessor.** Non-render consumers read inline content through an accessor backed by a node-keyed, non-reactive WeakMap, validated on read by `raw` plus the link-reference signature, with no dirty flag. The render path computes locally and caches nothing.
- **Eager work deleted.** The whole-document inline sweep at load and per commit is gone; undo, redo and link-reference edits no longer re-parse the document inline, and the common keystroke no longer double-parses the edited block. The link-reference map rebuilds only when a commit could change the reference set.
- **`inlineContent` removed from `CstNode`**, accessor-only, narrowing the 0.8.3 plugin freeze before any plugin bound to it.
- **The scale gate un-capped.** The giant single list, blockquote and table fixtures are measured and gated at 10MB: load is linear and windowing bounds the mount, so the keystroke is O(viewport).

Internal only.

### 0.8.3 — Plugin-API contract freeze (foundation)

Freezes the foundational plugin-facing contract, the shapes external plugin code binds to, while changing it is still cheap and before any binding. Not exposed from `index.ts` yet.

- **Node identity.** `CstNode.kind` widens from `BlockKind` to `AnyBlockKind`, the built-in union plus branded plugin kinds, so a plugin-kind node is a first-class CST citizen through render, measure and serialize. A structural `isBlockNode` guard replaces kind-based narrowing, which the widening made unsound.
- **Registries are code, not state.** The five kind-keyed registries (block-kind descriptors, components, openers, commands, paste surfaces) are register-once and a duplicate registration throws, on the `customElements` model. `augmentBlockKind` stays the deliberate-merge path, and there is no runtime unregister or replace.
- **Plugin-kind naming.** `declarePluginKind` rejects collisions with built-in kinds, the reserved structural sentinel `document`, and previously-declared plugin kinds.
- **Events access.** `getEvents()` is the canonical accessor.

Internal only.

### 0.8.2 — Inline-widget registry (consolidation)

The decision "is this inline node a live atomic widget, and how is its widget-ness recognized" is single-sourced into one registry, replacing logic spread across a model predicate, the renderer's raw-HTML branch, the `<br>` tag allowlist, and an unenforced doc comment.

- **Recognition is registry-owned.** One predicate answers widget-ness for every consumer (vertical skip, edge select, cursor adjacency, clipboard, the renderer), so a new widget inline kind registers rather than editing scattered branches.
- **Builders dispatch by layer.** The core `<br>` builder is registered; the image builder stays injected per render, since it carries the per-instance broken-URL cache, and is never process-global. The per-block `renderImagesAsWidgets` policy stays on the block-kind descriptor.
- Behavior-preserving, with an identical widget set. Internal only.

### 0.8.0 — Latency attribution + first-edit re-render fix

Attribution traced the nested-1MB keystroke cost to two sources: a dominant steady-state reactive flush proportional to mounted components, which ratified virtual rendering as the primary spine, and a one-time first-edit full-document re-render, fixed here. The link-reference resolver was reassigned a fresh identity on every edit, re-rendering every block that read it at mount; it now reassigns only on a signature change, and the render path reads it only for bracket-bearing blocks. Record: `docs/design/performance.md`.

Internal only.

### 0.7.12 — Module-readiness completion

- **Breaking: `index.ts` is curated to exactly what an `<Editor>` consumer needs** (the component plus its props, resolve and policy types, `parse` and `serialize` with inline preprocessing, and the node, inline and event-payload types). Internal plumbing (`LIST_CONTEXT_KEY`, the tree-op primitives, `createUndoManager`, `cloneDocument`, `assignIds`, the editor keys module) is pulled back, on the asymmetry that adding an export later is non-breaking while removing one is breaking. The four test and debug methods moved behind `editor.__test`.
- **Two consumer docs landed**: a module README and `docs/guide/consumer-guide.md`.
- **`dev-warn` decoupled from the build toolchain** through an injectable env seam (`configureEditorEnv`).

No behavior change. Internal only.

### 0.7.11 — CSS ownership migration

The editor module owns its CSS. Two stylesheets ship under `src/lib/styles/`: `editor.css`, the structural painting rules, auto-imported, and `editor-theme.css`, the editor-owned token values, consumer-imported. Every painting rule is wrapped in `:where(.editor)`, giving full namespacing at zero added specificity. Editor-owned tokens are declared at `:root`, while host tokens are only read with a fallback, so the host's own theming keeps winning. Engineered for zero visible change and verified pixel-identical in both palettes.

Internal only.

### 0.7.10 — Editor boundary-hardening

- **Error boundary and commit rollback.** A new `error` channel on the editor's event surface (`EditorError`, with `origin: subscriber | render | commit`); each block is wrapped in a boundary, so a render throw degrades to a recoverable failed-block fallback with siblings intact; the commit ceremony captures both undo stacks before the push and restores them on a throwing mutation, never publishing a partial tree.
- **URL and link policy.** A pure scheme allowlist enforced at the render sinks blocks `javascript:`, `vbscript:` and `file:`, and `data:` in an href, defeating control-character obfuscation; a blocked scheme renders inert. Three consumer seams land with today's behavior as the default: `resolveLinkUrl`, `imageLoadPolicy` and `onLinkActivate`, the last replacing a hardcoded `window.open`.
- **Accessibility baseline.** WCAG 2.1 AA declared as the target; the editor root gains `role="group"` and an aria-label; the otherwise invisible cross-block selection is announced through a visually-hidden live region.

### 0.7.9 — Command registry + per-kind keybinding declaration

Per-block-kind keybindings became declarative: `BlockKindDescriptor.keymap` maps a normalized chord (`Mod` is Ctrl or Cmd) to a command id, dispatched through a command registry that replaces the scattered keydown branches. The registry single-sources the vocabulary and registers global commands as free functions, exposing per-kind dispatch for a focused leaf and kind-only resolution for container bubble handlers. Block-local bodies run on the focused component through `BlockComponent.runCommand(id, arg?)`, which reads the caret live so cross-block dispatch operates at the collapsed position.

**Behavior change:** normalized chords match modifiers exactly, so modifier-augmented variants the old loose guards incidentally caught now fall through to native.

### 0.7.8 — Schema seam

Three waves making the block-kind schema the single dispatch authority. Behavior-preserving.

- **Op-vocabulary substrate.** One operation-detail map derives the operation kind union, the op descriptor and `EditEvent`, so kind and detail drift is a compile error. Plugin kinds become nameable through a branded `PluginBlockKind` (`declarePluginKind`), while `CstNode.kind` deliberately stays `BlockKind` until the 0.8.3 freeze.
- **Declarative per-kind entry.** The parser's opener chain is registry-driven, kinds declaring `{ priority, tryOpen, interruptsParagraph }`, and the paragraph-interrupt scan derives from the same declarations. Container paste-merge is declarative. Accepted, measured cost: registry dispatch adds roughly 8 to 16 percent to full-document parse on block-dense shapes, on the load path only.
- **Unwrap roles and declared rebuilders.** Containers declare Backspace-unwrap behavior through `unwrapRole`, naming a first-child and a middle-child strategy, and `rebuildRaw` is declared at registration.

### 0.7.7 — Performance harness + inline-sweep scoping

The scale gate became measurable: a deterministic, golden-pinned fixture corpus feeds dev-mode perf instruments, a bench suite over parse, clone and ancestry rebuild, and a gated Playwright project recording fixture load and per-keystroke p50 and p95.

- **The per-edit inline sweep is scoped to a dirty set** (one top-level subtree on the typing path, whole-document only on a link-reference signature change or a structural op), and ten dead resolver-less inline calls were deleted. Honest attribution: the sweep was not the dominant per-keystroke cost.
- **A real bug surfaced.** A typing batch displaced within the debounce window dropped its `input` event, leaving the previous block's inline cache resolver-less; displaced batches now flush on key change.

### 0.7.6 — Block-edit ladder + decomposition

The top-level and container block-edit factories stopped duplicating their structural-edit bodies: a commit-scope adapter captures every per-level difference, and one core writes split, merge, delete, replace and metadata once against it. Behavior-preserving.

- Two logged defects closed along the way: the IME-composition cross-block delete converged onto the commit primitive, and the empty-ancestor cleanup no longer drifts a surviving ancestor's `childIds`.

### 0.7.5 — Property/fuzz-test the invariants

Generator-based coverage over the load-bearing invariants: round-trip and parser totality over arbitrary and malformed input, EOF edge states, the inline-conformance corpus, the ambient-prefix text spine, the inline-offset partition, serialization purity, the selection partition, split and merge id alignment, and the paste dual-emit. A registry-derived conformance kit holds any container kind to the per-container invariants.

### 0.7.4 — Structural-sharing undo

Undo checkpoints stopped deep-cloning the document. Snapshots share the live tree's nodes, marked by an editor-level sharing epoch, so a push costs O(top-level children), roughly a thousandfold reduction, and per-snapshot heap drops to kilobyte-scale spine divergence. The cost moves to mutation discipline: copy-path-on-write everywhere, with the commit primitives owning the protocol. Aliasing is guarded three ways: an invariant forbidding a mutation that writes serialized bytes through a snapshot-shared node, a dev integrity oracle digesting and re-verifying each snapshot at every commit and restore, and a property driving random op sequences through the real action factories.

The canonical discipline that came out of it: write the copy into the `$state` tree, then re-read it through the tree before further use.

### 0.7.3 — Spec/doc accuracy

Design-doc reconciliation from the architecture review, plus the invariant catalog at `docs/design/invariants.md`.

### 0.7.2 — Node-model & schema guardrails

Convention-enforced invariants became compile-time and runtime-checked. Compile-time: typed `metadataOf` and `BlockMetadataByKind`, `defineBlockComponent`, a union-derived block-kind table, a `containerContract: 'strip' | 'grid'` descriptor field, branded `CURSOR_END` and `SELECTION_END` sentinels, and a cell-coordinate discriminant on `SelectionPoint`. Runtime: a dev-only, non-crashing assertion channel wiring checks at the commit primitive, bootstrap, node clone and the nested-actions helper, and a block whose kind has no registered component renders as a visible raw block.

### 0.7.1 — Table cell inline rendering and paste fixes

- Reference blocks re-render when a link-reference definition changes elsewhere, with the render memo keyed on the signature and gated to reference-bearing blocks.
- Blockquote-into-blockquote paste no longer destroys the target paragraph.
- Typing or pasting across two top-level tables no longer corrupts the grid raw; carets are character-addressable deep paths with identity-resolved survivor paths.
- Table cells render inline content through the same pipeline as prose, with widget-aware cell offset reads and cursor input and output.

### 0.6 — Complete GFM Coverage

Every GFM construct parses, renders and edits, shipped as 0.6.1 through 0.6.7.1. Task list items gained click-to-toggle checkboxes on a new ambient-prefix interactive-range contract, with a source-preserving `taskMarker` metadata field. Backslash escapes and HTML character references landed as CommonMark §6.1 and §6.2 pre-passes. Tables became per-cell editable containers, with Tab, arrow and Enter navigation, rectangular selection, row and column ops, an alignment cycle, three-stage Ctrl+A and pipe-aware paste. Images render as atomic inline widgets with dimension hints, drag and Shift+Arrow resize, and a `resolveImageUrl` hook. Autolinks closed the GFM §6.9 gaps. Reference-style links and images resolve in all three forms with document-level resolver reactivity. HTML blocks meet the §4.6 per-type close conditions and the paragraph-interrupt rule, and inline raw HTML parses with allowlisted tags as atomic widgets. The paste-into-list family converged on one rule: absorb on a matching list type, break out on a mismatch, with newline-terminated splices and pre-splice marker computation; Enter on an empty nested item outdents one level.

### 0.5 — Structural spine + pre-coverage seams

Every structural mutation unified on one commit primitive with the `editor.events` seam (`edit` plus `selectionChange`), multi-scope commits for cross-container mutations, structural-change descriptors auto-syncing ids and refs, a metadata-only commit path, and a block-list state registry closing the children-mutation bypass sites. One paste dispatcher replaced five paste sites. The debug engine and the `/test/editor` panel gave investigations a structured CST, selection, undo and ops view. The list marker moved inside the contenteditable as the ambient-prefix contract, unblocking task checkboxes, and the `SELECTION_END` and sticky-column two-axis contracts were pinned before tables. Correctness sweeps fixed cross-block typing event emission, id preservation through IME, ambient-aware measurement, multi-line link reference definitions, and CRLF hard-break matching.

### 0.4 — Cross-Block Selection & Clipboard

Cross-block selection, overlay rendering, keyboard and pointer extension, and clipboard operations spanning multiple blocks. Path-based addressing (`path: number[]`) replaced flat block indices throughout the selection and undo layers; selection state is lazy, null in single-block mode, with cross-container start-wins semantics; the selection overlay mounts at the block host; Shift+Arrow, Ctrl+Shift+Home/End and double Ctrl+A extend from the keyboard; pointer drag is rAF-throttled with autoscroll; copy, cut, paste, delete, backspace and type-replace all span blocks, and undo restores cross-block selection state.

### Pre-0.4 history

Compact summary; see git log for the full record.

- **0.3.5** — Code-block rewrite: `<textarea>` → `contenteditable` with live highlight.js syntax (17 bundled languages via plugin-shaped registry), sticky-column participation (retires the "opaque block" category), Tab / Shift+Tab indent, ArrowLeft / ArrowRight boundary navigation, paste fence-length bump.
- **0.3.4** — Architecture refactor (no user-visible change). `EditorActions` god interface split into four concern-specific sub-interfaces; container-state primitive layer extracted; `tree-operations.ts` and `parser.ts` split per-kind into directories; `inline-parser.ts` split by pipeline stage; cursor/visual-line helpers extracted to `text-surface/`.
- **0.3.3** — List/blockquote unwrap rules (U1/U2/M1), cross-container Backspace merge, MergeRole role refactor (replaced `MERGEABLE_PAIRS` set), pixel-X sticky column foundation. Fixed `isItemEmpty` data-loss bug + blockquote stuck-caret traversal.
- **0.3.2** — Foundations: geometry-based focus traversal, recursive list parsing (nested sub-lists, continuation lines, multi-paragraph items), multi-block paste, forward delete, Tab/Shift+Tab list indent, Ctrl+B/I inline formatting. Fixed `bind:ref` ref-array drift after structural ops.
- **0.3.1** — Container raw propagation for nested edits (lists + blockquotes); list-item marker round-trip preservation.
- **0.3** — Inline parsing: backtick spans, delimiter-run emphasis/strong/strikethrough, links/images/autolinks, hard line breaks. Inline renderer with dimmed marker spans, cursor save/restore through the span tree, per-input re-render. Markers extracted via `raw.slice()`, never reconstructed.
- **0.2** — Block editing: editor shell with CST ownership, full component hierarchy (Text/Code/ThematicBreak/Blockquote/List/ListItem), tree ops (split/merge/delete/updateContent), merge eligibility rules, container raw reconstruction, undo/redo with snapshot-based CST cloning + debounced batching, parallel ID array for stable keyed rendering, list Enter behavior. Fixed container ID desync on undo/redo, double chars, cursor loss in leaf↔container transitions.
- **0.1** — CST foundation: single-pass line-oriented GFM block parser producing mutable `CstNode` tree, all block types with recursive container parsing, metadata extraction (heading level, fence markers, list markers, task items, etc.), lossless `serialize(parse(source)) === source` round-trip, `leadingTrivia` / `prefix` / `suffix` whitespace fidelity.
