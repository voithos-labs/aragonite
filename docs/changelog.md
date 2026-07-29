# Changelog

Editor version history (CST block editor). **Style (pre-v1):** one tight entry per minor version; patch versions are working notes that collapse into the parent minor at the next bump — per-bug narratives belong in `git log`.

### 0.9.36 (unreleased)

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
  event's target being the root itself. Two families decline rather than guess: a table, whose
  offset is a cell index and so has no "end of that line", and a non-editable leaf like a
  thematic break, which would otherwise take the whole-block focus a click ON it means and arm
  the next Backspace against a block the user only clicked near. Both are in `docs/issues.md`.
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
  which door it uses — or say what it does instead of placing a caret. The rule cannot be seated
  in a funnel, and that is measured rather than assumed: `BlockComponent.focus` is the obvious
  candidate and is the same call the cross-block dispatcher parks its own caret with mid-extend,
  so a clear seated there reds three extend specs. `focus` is therefore documented as a park
  primitive; the consumer door that ends a range is `setSelection`, and both halves are pinned.

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

Ship gates: unit 5367, e2e 1571, check 0/0, lint 0, perf:check 11/11 gated rows (gate
restructured this minor — the 24-row count was the 0.9.35 spec layout; row shape verified
identical at the batch base).

### 0.9.35: the navigation API + toc v2

Path-addressed navigation became a public surface, and the two bundled plugins that had been bare
surface dogfoods — toc and highlight-occurrences — grew into the shapes a real editor's user
expects. This closes the GitHub-parity package's editor side on the package's own rule: every
capability gap a plugin hit was closed at the API level first, then consumed by the plugin.

- **`rects.scrollTo(path, opts?)` shipped as the one navigation seam.** `reveal(path)` keeps its
  mount-only semantics (measuring something offscreen must never scroll); its new sibling mounts the
  target and then scrolls the viewport to it, and search's private reveal wiring migrated onto it
  rather than leaving a second copy of the rule. Reveal-and-scroll turned out to be two
  responsibilities: `scrollIntoView` places a target once, but a windowed-out target past undecoded
  images strands anyway — the images reserve height off-window and collapse on mount, so the document
  shrinks and the browser clamps the scroll away from it. So `scrollTo` sets the reveal anchor at the
  requested placement and the windowing scope re-asserts it on every post-mount measure pass,
  refining `'center'` to exact placement once mounted and then releasing it. The boolean resolves
  only after the position settles, so `true` means genuinely in view. Fixing the strand surfaced a
  root defect underneath: the anchor correction wrote `scrollTop` directly, which fires no `scroll`
  event, so the window's derived scrollTop stayed stale and never re-sliced — the target sat at the
  anchored position, unmounted.
- **Block components reach the editor's geometry.** `BlockComponentProps` grew a `rects` field
  carrying the owning instance's rect surface (growth-as-fields, the frozen-shape rule), delivered
  through editor context and threaded on both of BlockHost's dispatch branches — pinned by a parity
  lint that fails the day a branch drops it, and which codifies the previously e2e-only `document`
  precedent alongside it. A block can now reveal, scroll, and measure without an editor context it
  does not have. Caret placement by path stays deliberately unexposed, recorded in the contract as a
  decision rather than an omission.
- **The toc plugin became a table of contents.** Entries indent by heading level; labels project the
  inline parse to clean text (formatting markers dropped, links and images reduced to their text,
  emoji and entities shown as their glyph); the heading walk recurses into containers, so a heading
  inside a blockquote or a callout is listed; and each entry is a real button that navigates to its
  heading on click or Enter, in every presentation mode — a navigation click is view-only, verified
  against the reading-inertness lint rather than assumed. `tocPlugin({ maxDepth })` trims the outline
  to the top N levels, and the heading-level read the hierarchy needs graduated to the authoring
  barrel as `headingLevel`. Navigation is serialized per block (one scroll in flight, latest target
  wins), so overlapping clicks cannot strand the later target on the process-global reveal anchor.
  The stretch goal — GitHub-style slugs plus `#fragment` link navigation — stayed a roadmap entry
  with its design sketch: the slug half is cheap, but resolution needs an inline-link-activation seam
  the editor does not have, plus a which-gesture-navigates-versus-edits decision the toc plugin
  cannot make alone.
- **highlight-occurrences hardened into the shape its own recipe describes.** The word index is built
  once per edit epoch and a caret move re-filters it with a single map read, where before every
  un-debounced selection change re-walked the whole document. Non-prose leaves are skipped through
  the descriptor's declared `supportsInline` capability rather than a kind check — deliberately
  narrower than the true mark-painting set, since code blocks do paint marks and occurrence
  highlighting is an inline-prose feature. The export unified with its siblings as
  `highlightOccurrencesPlugin()`, and the plugin-guide recipe that contradicted the implementation
  now tells one story with it.
- **A `source` prop swap now signals the decoration engine.** The edit epoch means "the document
  changed", and a whole-document replacement is that, but the swap reset (doc, ids, refs, undo,
  selection, LRD resolver) never notified the engine, so every epoch-memoized source kept serving a
  document that no longer existed: occurrence marks painted into the wrong blocks, and an open find
  bar held its old count over a phantom overlay. The bump site is now one named function both the
  post-commit subscriber and the swap reset call, so the guard and the deferred tick cannot diverge
  between them. The gap predated the epoch itself; what this milestone added was the first bundled
  consumer of the memo and the recipe telling third-party authors to build on it.
- **Strip containers reorder and copy through declared capabilities, not kind names.**
  Reorder-within membership became a container-descriptor capability (`reorderChildren`, whose one
  honest sub-discriminant is `renumberMarkers` — only ordered-list markers are position-dependent),
  and the clipboard's sole-child marker recovery keys on the `strip` container contract. Both had
  dispatched on a hardcoded `list`/`blockquote` allowlist, so a plugin strip container — a native
  alert, a footnote definition — fell through: a body child's reorder teleported the whole container
  among document siblings, and a partial copy lost its wrapper. Correcting the ledger entry this
  closes: the predicted marker-dropping corruption is ceremony-masked and was never observable in
  committed state (the commit ceremony rebuilds a scope container's raw through its own descriptor),
  so the real defects were the teleport and the wrapper-less slice, and the reorder rebuild hardcode
  is deleted rather than routed. The parity lint that would have caught the class now scans
  `editor-actions/` and `selection/` beside `tree-operations/`.
- **The oracles and the showcase track the new surface.** A reorder-within gesture joined the
  github-alert simulation family under the structural and convergence oracle stack, and new e2e
  specs cover the scrollTo settle over an image band, toc navigation (windowed-out target, keyboard
  entry, both presentation modes), and the occurrence memo through a live scan counter rather than
  timing. The `/` showcase nests its headings so the outline's hierarchy is visible, and the consumer
  guide documents the navigation door — the honest boolean included — end to end.

Ship gates: unit 4606, e2e 1506, check 0/0, lint 0, perf 95, perf:check 24/24.

Post-stamp records: the perf baseline's e2e rows were re-blessed 2026-07-24 on the calibration
machine (27 fixture rows; the gate re-verified green against the fresh floor) and the README's
perf and lines-of-code charts re-rendered from live data — library ~53k lines, tests ~97k,
eight bundled plugins.

**Post-ship review (2026-07-24).** A repo-wide forge review of this version, and the fixes it
routed. Twenty scopes covered the library source, the docs and comment corpora, stylesheets, CI,
packaging and the e2e suite; the unit suite's own quality was the one artifact class no pass
reached, and it carries forward to the pre-freeze re-audit. The record itself stays in git history
rather than a tracked document, following 0.9.27 and 0.9.32.

- **A non-advancing block opener hung the parse loop in production.** The github-alert marker
  accepted unbounded leading indent while the blockquote extent scan refuses a four-space line, so
  the opener consumed nothing and the loop spun. The guard that caught it was DEV-only, so a
  production build tree-shook the check and a hand-typable document froze the tab on load. The
  marker is bounded to CommonMark's 0-3 space rule, the opener declines when the extent does not
  advance, and the parser now treats a non-advancing opener as a decline in every build. That last
  part is what makes "the worst case for a parser bug is bad styling, not a corrupted file" true
  for a third-party opener and not just for the built-ins.
- **One byte-corruption family, closed at its seams.** A block's trailing ending must come from the
  block's own raw, never a literal: four reported sites turned out to be nine, because the root
  cause was a shared paragraph mint hard-coding `\n` across four branches at once. A second pass
  found seven live mint sites that took that parameter's default and downgraded a CRLF document
  the same way. Two guards landed with them, since a call-site scan cannot see a pure transform or
  a defaulted parameter: a third lint arm covering container rebuild provenance, and an
  outcome-level oracle that runs thirteen gestures over an LF fixture and its CRLF mirror and
  asserts the results match. Separately, the cross-block inline paste arm was the one paste route
  mutating children outside the commit ceremony, so a container's ids desynced permanently and no
  edit event fired at all; the list terminator patched a nested container's raw without its
  children, which mashed two list items together on the next edit; fence lines came into range for
  indent, dedent and CRLF forward-delete, each of which could un-close a fence and let the block
  absorb the rest of the document on reload; and image alt escaping became idempotent instead of
  doubling backslashes on every commit.
- **Every inline recognizer now bounds its decline, not just its claim.** Three of the six inline
  recognizers scanned to the end of the range before declining, which is quadratic in the block. All
  three are bundled rungs; the fourth bundled rung (emoji) was already linear. At 96 KB in one
  paragraph, over a full inline parse: latex `$` 8168 ms to 8.8 ms, footnotes `[^` 15407 ms to
  18.4 ms, the directive text tier 2779 ms to 14.4 ms. Each materializes its decline predicate once
  per block behind a bounded memo and looks it up per consultation. The latex leg needed no
  adversarial intent: a paragraph of shell documentation is ordinary content. The autolink
  delimiter prune was quadratic too (677 ms to 38 ms at 384 KB) and became a binary search over the
  sorted, disjoint match list, which took two `RangeError`s with it; the wrapped-inline renderer was
  de-recursed to a frame stack, removing a stack overflow and running about twice as fast at every
  depth. A realistic paragraph carrying all four constructs parses in 0.052 ms with every parse a
  forced cache miss, so the headline costs nothing at the keystroke.
- **The release path and the review workflow.** The tarball verifier moved onto the publish
  lifecycle, where it had been running in CI only, so a dangling export subpath can no longer ship;
  repository metadata was added; and the docs-pack script's unguarded recursive delete is gone
  rather than guarded. The review workflow's blast radius over untrusted PR content narrowed: the
  job token no longer persists in the checkout, default permissions drop to read, and the prompt
  frames fork content as data. What did not change is the trigger gate, which was already
  admin-gated and fail-closed.
- **The review corrected the project's own records.** Three ledger entries rested on claims this
  run falsified by measurement: two of four "measured linear" sibling flood paths were quadratic,
  and the installed-rung cost model priced a consultation as constant when three of the four
  bundled rungs scanned the whole block before declining. The closure-cell entry's hypothetical
  turned out to be live, on a built-in: the thematic break's cells promise focus-then-delete while
  the kind declares no `blockFocus`, so it deletes on the first press, and the design spec and the
  published plugin guide had been teaching it as the reference model. The attribution is corrected
  in both, and the descriptor's own cells are ledgered as the live instance.
  `CLAUDE.md`'s layer-contract sentence and its new-block-kind rule were both false as written, and
  the documented ship gate named a script that already runs inside `npm test` while the real
  ceiling gate went unnamed in every contributor doc.

Review gates: unit 4606 to 4695, e2e 1506 passed / 60 skipped with zero flaky over two full
batteries, check 0/0, lint 0, perf:check 24/24 with several fixtures faster than the fresh floor.

### 0.9.34: emoji + native alerts + parity smalls

GitHub-parity extensions rode the surfaces the recent minors shipped: `:shortcode:` emoji on
the 0.9.33 inline ladder, native `> [!TYPE]` alerts as a first-class container kind, and the two
small GFM-parity fixes (single-tilde strikethrough, the ` ```math ` fence). Every one is
byte-preserving and uninstall-clean: an installed extension changes rendering, never the source.

- **Emoji shortcodes shipped as the first bare-trigger inline kind.** `:shortcode:` renders as an
  atomic glyph widget on a bare `:` rung priced above the directive text tier, so the two disjoint
  grammars coexist on one trigger and a table-lookup miss falls through byte for byte. The literal
  `:name:` bytes stay in the raw, so round-trip and portability are untouched, and the widget
  carries the decoded-entity edge policy (atomic delete, step-over caret). A gemoji shortcode table
  is generated and checked in (no runtime or network dependency), and recognition is install-gated.
  Ships at `aragonite/plugins/emoji`; the roadmap's 1.3 emoji item graduated pre-freeze.
- **Native GitHub alerts became a first-class container kind.** A blockquote whose first line is
  `> [!TYPE]` parses as its own `githubAlert` strip container (the ATX/setext per-kind precedent),
  reusing the blockquote extent scan and the shared admonition chrome. The marker line lives only
  in the container's raw and metadata, and the bytes are never rewritten to `:::`. With native
  rendering shipped, the admonitions paste transform became opt-in
  (`admonitionsPlugin({ convertAlertsOnPaste: true })`, default off): pasted GitHub bytes now stay
  GitHub bytes and render natively, and the whole-document convert affordance is untouched.
- **Two GFM-parity smalls landed.** The emphasis scanner now accepts tilde runs of length 1 or 2
  per cmark-gfm: `~x~` and `~~x~~` both strike, a run of three stays literal, and a mixed-length
  pair never matches (GitHub does not set `DOUBLE_TILDE`). The conformance pins that asserted the
  old literal `~x~` reading were re-baselined. And GitHub's third math form, a fenced block whose
  info-string first token is `math`, parses as a distinct `mathFence` kind sharing the block-math
  render component; uninstalled it stays a lossless plain `math` code block.
- **The corruption oracle tracks the new surface.** Two simulation gesture families drive the new
  kinds under the structural and convergence oracle stack: emoji adjacency (mid-prose insert,
  both-directions atomic step-over, single-press delete, undo unwind) and github-alert container
  editing (from-scratch formation, kind-stable inner edit, contained middle-child merge,
  marker-dropping unwrap). The alert and math-fence kinds each gained interactive e2e coverage, and
  all three surfaces appear on the `/` showcase and in the consumer and plugin guides.

Ship gates: unit 4547, e2e 1479, check 0/0, lint 0, perf 95, perf:check 24/24.

### 0.9.33: inline priority ladder + footnotes

The inline recognizer gained a published priority ladder mirroring `OPENER_PRIORITIES`, and GFM
footnotes shipped on it as the first-party `aragonite/plugins/footnotes` plugin. The pre-freeze
probe's definition side (0.9.30) was rebuilt from an opaque leaf into an editable strip container,
and the reference side is newly built: first-class inline widgets on the prefix ladder, replacing
the probe's decoration-overlay approximation.

- **Inline precedence overrides shipped.** The scan stage now consults a per-trigger rung list with
  published built-in anchors (`INLINE_PRIORITIES`), so a plugin recognizer can claim syntax that
  begins on a reserved trigger by registering a prefix rung priced below the built-in, the inline
  mirror of an opener pricing below a built-in. `[` stays a reserved trigger (a bare registration
  throws), but a `[^`-prefix rung wins it only where `[^` matches, and an unterminated `[^` declines
  and falls back to the built-in link reading byte for byte. Rungs on one trigger dispatch by
  priority ascending, then longer-prefix-first, then lexicographic, independent of registration
  order. Graduated from the roadmap's 1.2 precedence-override item, build-validated by footnotes.
- **Footnote definitions are an editable strip container.** `[^label]: content` parses to a
  not-mergeable container in the listItem mold: the `[^label]: ` marker paints as a dimmed ambient
  prefix on the first child, the body is real child blocks, and the container rebuilds its raw from
  the marker plus four-space continuation indents so a post-edit rebuild canonicalizes exactly as
  listItem does. The container factory grew a `getAmbientPrefix` thunk to forward the marker.
- **Footnote references are first-class inline widgets.** `[^label]` recognizes through the new prefix
  rung and renders as a superscript whose number derives reactively from first-reference order: an
  earlier reference typed elsewhere renumbers a widget live though its own block is never edited and
  its source never changes. The literal bytes stay in the raw, so round-trip and GFM portability are
  untouched, and a caret-adjacent destructive key reveals the source rather than deleting the
  reference whole. Numbering is a pure function over the read-only document (`assignFootnoteNumbers`).
- **The corruption oracle tracks the new surface.** A `footnote-ops` simulation drives both tiers
  under the structural and convergence oracle stack: reference type / reveal / edit / delete, and
  definition formation, mid-body split (pinning that the split grows the container and never the
  root, the blockquote-override boundary), and not-mergeable exit. The plugin ships at the
  `./plugins/footnotes` subpath, showcased on `/` and documented in the consumer and plugin guides.

Ship gates: unit 4396→4442, e2e 1463, check 0/0, lint 0, perf 95, perf:check 24/24.

### 0.9.32: the elegance run

An owner-directed whole-repo elegance pass: simplification, dedup, dead-code removal,
and evidence-gated performance work, run as thirteen read-only discovery surveys over
every subsystem (library, tests, e2e, shell, perf), a triaged ledger (~110 accepted,
every rejection recorded with its reason), and twenty-odd reviewed fix batches. Net
effect: the same behavior on fewer, better-homed lines — and three real latent bugs
found because rules moved into seams.

- **Rules moved to choke points.** The clipboard copy/cut/paste ordering lives in one
  `createClipboardHandlers` seam (four surfaces supply only their genuine arms); the
  pointer-drag lifecycle (listener trio, rAF coalescing, autoscroll, teardown,
  pointerId filter) lives in one `createPointerDragSession`; the end-wall deletion
  atoms live in the range-delete ceremony; a shared `NodeScope` carries the container
  getter trio once; `BlockquoteBlock` rides the container seam its docstring claimed
  to mirror. `emptyParagraph`, `remapStrippedLines`, `mintWidgetShell`,
  `cellRowCol`/`intraTableRect`, `readBlockPath`, `blockAtPoint`, and the segment
  walk inside `widget-offset` each collapsed multi-site duplication into one home.
- **Three latent bugs surfaced by the consolidation, fixed red-first.** CodeBlock and
  non-reveal table cells prevented the native paste only after the first await —
  provably too late, masked in e2e by the CST-authoritative re-render; a second
  pointer could end another pointer's drag on three of four lifecycles (only table
  filtered `pointerId`); the task-checkbox strip left stale `ParsedLine` offsets on
  the public opener surface.
- **The superseded paste mechanism is gone** (`insertParsedBlocks`,
  `foldPasteReplacement`, −204 lines) and its G2.9 invariant was rewired
  depth→strategy onto the live path — whose `paste`-op side had been unguarded.
  List-overrides' hand-copied delete/replace fell through to the shared core, gaining
  the noop-discard, focus-offset, and backfill guards it had drifted away from.
- **Evidence-gated perf.** Three refactors rejected on measurement (the
  commit-preview parse-once, the autolink prune — observed linear, the emphasis
  linked-list port — quadratic but confined to the documented transient axis, now a
  ledger characterization); three pure-waste removals shipped with two-sided pins
  (the keydown island scan, the dead caret-carry walk, and render keys folding a
  compact LRD epoch instead of the ~MB signature string). Two perf watches closed
  no-action (BlockHost heal, parser laziness). `perf:check` 24/24 with p50s at or
  below baseline throughout.
- **The plugin surface grew two additive conveniences** (`surfaceProps` on the
  editable leaf — a consumer can no longer drop a handler; `getPresentationMode` on
  the container factory) plus `containerClosure` beside `simpleLeafClosure`, all
  guide-documented pre-freeze.
- **The suites got cheaper to extend without losing a test**: ~750 lines of copied
  unit-harness assembly became four helpers with the live-getter contract; 31 test
  files moved to mirror their sources; two monoliths split as proven pure partitions;
  the e2e helper families (cell drag, pageerror capture, sim oracles, search split)
  consolidated coverage-neutrally; a new lint pins the block-content selector so the
  9-site parity rot cannot regrow.

Final commit gate: unit 4346→4396, e2e 1449, check 0/0, lint green, perf:check 24/24.
Per-fix miss-analyses live in `git log`; the run's triage ledger (accepted, rejected
with reasons, measured, deferred with anchors) is the durable record of what was
deliberately NOT done.

### 0.9.31: five reports and a ledger burn-down

Five same-day user reports answered, then the known-issues ledger cut from 22 entries to 11
in one dispatched pass: every fix red-first, every substantive diff adversarially reviewed,
and each surviving entry re-verified to carry a named deferral anchor.

- **User reports.** Enter in a setext title no longer demotes the heading and strands the
  underline as a junk block; split keeps a structural suffix with its block via a generic
  content-range rule at the `splitNode` choke point. Focused whole-block blocks (thematic
  break, mermaid) and selected inline widgets copy and cut with Mod+C/Mod+X, landed once in
  the shared seams so every kind of each tier inherits the gesture. Fence lines hide whole in
  reading and preview (a CSS-reachable wrapper per fence line; the bare-newline Chromium caret
  workaround proved dormant when faithfully reconstructed and was retired into a guarded e2e
  pin). The details disclosure caret centers on its summary line (buttons don't inherit
  font-size, so its em geometry resolved against the UA default). `check` runs at 0 errors
  0 warnings (the deliberate-interaction a11y suppressions; role questions stay parked at 1.1).
- **Byte fidelity.** Three CRLF defects closed red-first: the trailing `\r` (trim at the
  source slice), the interior highlighter mangle (highlight an LF copy, positionally restore
  each original ending, count-mismatch dev-warn at the seam), and the all-blank reading
  collapse. The wider-than-header truncation left the ledger for `syntax-tree.md` as accepted
  GFM-mandated normalization.
- **Caret and clipboard parity.** The post-paste caret now honors the documented contract on
  all ten routes (three divergent gates fixed, the residue-skip rule single-sourced into one
  seam); range-delete survivors descend by focusability rather than merge-eligibility;
  cross-block type-replace re-derives the surviving leaf's kind; copy during an active reveal
  reads the live DOM instead of stale raw.
- **Cells reach prose parity.** Decoration islands render and inline widgets reveal inside
  table cells through the prose seam's own machinery, guarded by a cell commit wrapper that
  escapes pipes and strips newlines (the row-splitting corruption a naive wire-up ships).
- **Entities render.** `&copy;` shows © as an atomic inline widget, the first consumer of the
  `deleteGranularity: 'atomic'` policy, gated to visibly-rendering glyphs (lone combining
  marks stay literal-source spans). Pulled forward from the 1.2 sketch.
- **Reload convergence.** An unclosed fence auto-closes when Enter-exit authors a block below
  it, so save-then-reload keeps the authored structure; the simulation's parse-convergence
  oracle is now unconditional (the exemption mechanism deleted whole). The closed/unclosed
  exit-scope asymmetry it surfaced was then decided in-container: the closed exit mints its new
  paragraph inside the fence's own container scope too, unified with the auto-close and the
  whole-block Enter tier.
- **The suite grew teeth.** New simulation gestures for decoration islands, block decorations,
  IME composition (driven over CDP), and atomic entities; the `DocPath` brand adopted across
  every op-family path composer with completeness enumerated by the compiler; G4.8 gained the
  clipboard-chord family and the consumer guide documents the new chords; the links-autolink
  test monolith split six ways at exact case parity; and the long-fixme'd reveal-blur spec
  fell to a systematic bisect that found no battery carrier at all, only a stale test premise.

Final commit gate: unit 4257→4346, e2e 1391→1443 (every project including simulation),
check 0 errors 0 warnings, lint green. Per-fix miss-analyses live in `git log`.

### 0.9.30 — The audit-response pass: an outside review, answered

A third-party audit of 0.9.28 (filed at `13e88c44`, retired with this entry — git history
holds the full report) was answered finding by finding; every wave landed on the full
commit gate (unit 4204→4257, e2e 1391, check 0, lint green throughout).

- **The freeze no longer cuts on first-party evidence alone** — the audit's highest-stakes
  finding, answered structurally: an external-author gate (a developer who is not the owner,
  tarball + docs pack, friction log blocking) in both the roadmap's freeze cut and the plugin
  contract's freeze criterion, and the 1.3 gap detector pulled in front of the freeze as a
  build probe. The **footnotes probe** — built strictly against the public surface, walls
  logged as findings — shipped the definition kind losslessly, proved the reserved-trigger
  limit end to end (`[` is unclaimable; references degrade to a decoration overlay), and
  falsified the feared linkReferenceDefinition collision (the built-in declines `[^` labels).
  Routed: the inline prefix-recognizer tier is designed ahead in the contract (additive-later
  by the freeze criterion, build-now candidate), and the reserved trigger set is now in the
  plugin guide — the probe's one doc blocker.
- **The closure tax on simple leaves is repealed.** `simpleLeafClosure` on `aragonite/plugin`
  bakes the five structurally-fixed columns and requires the four the component determines —
  omitting one is a compile error; toc/mathBlock/memo migrated with modes unchanged;
  via-string guidance (name your own mechanism, never an internal watcher). Containers keep
  the full nine on purpose.
- **The property suite gained the oracle it was blind without.** A kind-differential property
  (commonmark.js reference; the three documented divergence classes allowlisted by input
  predicate, never a baseline lookup) fails the emphasis misclassification the byte/tiling
  properties provably pass — the audit's own falsification, replayed red-first. An opt-in
  fresh-seed lane (`PROPERTY_FRESH=1`, seed printed for reproduction) threads all 22
  `fc.assert` sites; fixed seeds stay the deterministic gate. Miss-analysis: no property
  oracle read node kinds — conservation held while classification broke.
- **The three flagged internals are structural now.** The cross-block table-delete ceremony
  deduped into three order-stable atoms with each case's load-bearing orderings explicit (the
  identity scan measured at ≤1 per gesture and its cost class documented — the audit's
  "several times" was overstated); the reveal/fold machine behind one `RevealState` and one
  canonical reset every exit funnels through (null-before-await pinned by a
  synchronous-observation test); the commit rollback behind one frame with one restore
  (splice-then-throw pin covering the redo-populated dimension). All mutation-verified in
  review.
- **ESLint installed** — the missing standard net: curated flat config (floating promises,
  misused promises, switch exhaustiveness, unused values; type-aware over all `.ts`), wired
  into `npm run lint`. 514 findings triaged: 28 real cleanups, 45 intentional patterns made
  explicit (`void`, `default:`), 441 noise-class configured off with reasons, 5 reasoned
  inline disables. Zero live bugs in product code; product `src/lib` was already `any`-free
  and `no-explicit-any` now stands guard as an error there. One adopted rewrite regressed
  the demo plugins page — `prefer-writable-derived` moved a parsing read from post-mount
  effect to first render, ahead of the page's async plugin installs, firing
  late-opener-registration across e2e-plugins — caught by the ship battery and reverted
  with the deferral's load-bearing timing now stated at the site. Miss-analysis: the battery
  had the failure all along; a piped gate command masked its exit and only the
  passed-count discrepancy exposed it — the never-pipe-a-gate rule, re-learned at the
  controller level.
- **Docs tell the honest version.** The README's lossless promise carries its edit-time
  asterisk beside the claim; editor.md's "adding a block type is boring" carries the
  variation-vs-novel-capability discriminator; the fifteen dangling architecture-concerns
  comment pointers are gone; the docs link gate covers the whole corpus (code spans stripped,
  footnote definitions excluded, empty allowlist) — Markdown links only; HTML `<img>` embeds
  stay outside its reach.
- **Readability, audited and codified** (owner-directed): the ~20 most complex files scored
  against a written top-down rubric — 16 GOOD / 6 ACCEPTABLE / 0 NEEDS-REORDER, the
  newspaper discipline held — six approved moves only (five honest-section dividers, one
  487-line state-orphan hoist, contiguous block-node types in `core/nodes.ts`); the
  newspaper-order standard and the composition-root rule are now `code-style.md` content.

### 0.9.29 — The freeze-surface liveness pass: live reads become thunks

Pre-1.0 roadmap item 1, plus gap fixes from the exploration audit that preceded it. The scar
this closes: a getter property and a value property are structurally identical to TypeScript,
so an external author could pass a snapshot where the contract means "re-read live," compile
clean, and hit the stale-capture class beyond every internal oracle. Every live read on the
frozen factory deps surfaces is now an explicit thunk — value-capture does not compile.

- **Deps thunks.** `ContainerBlockDeps` / `EditableLeafDeps` `node`/`index`/`path` getters
  become `getNode()`/`getIndex()`/`getPath()`, stating the rule the shape now carries: a
  function-valued field is a live read re-evaluated per use, a plain-valued field is static
  config. Type pins keep value-capture uncompilable; G4.1 accepts the thunk-reference form;
  every in-repo consumer converted (the consumer example's reader prop also swept
  `CstNode` → `NodeView`, closing its ledger entry). The audit half is recorded: chrome
  deps and the decoration provide context carry only static config and per-call values —
  nothing else to convert — and the item's planned timing-primitive lint turned out to
  predate it (G4.4, shipped `02b00c3b`).
- **Trailing-line-ending parity (G4.20) + the CRLF class fix.** The new lint pins the
  keystroke-commit append; its inventory surfaced twelve sibling sites reconstructing the
  ending as a bare `'\n'` — CRLF-lossy on code-block commands, cut, edge-policy deletes,
  and reveal-fold — all moved to `trailingLineEnding(raw)`, with a representative CRLF
  gesture pin.
- **Per-block opener context.** The parser mints a fresh `OpenContext` per block, retiring
  the comment-only retention hazard on the frozen opener surface — a stashing opener now
  holds a stable object, pinned by a retaining-opener test.
- **Core gap fixes.** The inline-content cache splits into per-signature-space slots
  (interleaved resolver-less and resolver-ful callers no longer evict each other on every
  call — identity-pinned); the CommonMark §6.6 tag grammar is single-sourced into the
  type-7 HTML-block opener (the "must stay in sync" comment retired — divergence is
  unrepresentable); the perf docs re-match the gate they describe (nine fixture shapes, the
  1MB+10MB gated rows, the additive tolerance and runner scale, the counters.test.ts
  ceiling attribution); the plugin contract's registry enumeration is complete again.

### 0.9.28 — The forge-review hardening pass: a repo-wide audit, fixed to green

An owner-directed four-pass audit (bugs / design+docs / test quality / organization) over the
entire repo — every Critical/Important finding reproduced or revert-probed before fixing,
every fix landed test-first with its red quoted. The byte round-trip core survived a
dedicated hunt untouched; the fixes concentrate in structure-correctness, routing, and the
gates themselves. The full battery, conformance slice, and perf ceilings are green with zero
expected failures at the cut.

- **Corruption fixes.** Indented-fence rendering corrupted bytes on load-then-type (the
  audit's one critical); a typed `|` in a table cell shifted or silently dropped cell content
  on reload; a stale render key let undo be silently re-reverted after a kind flip;
  cross-block inline paste left a stale kind over new bytes; clipboard during a widget
  reveal spliced at stale offsets and muted subsequent typing; CRLF-authored documents
  normalized on details/mermaid/directive rebuilds and on the first keystroke.
- **GFM conformance + parser robustness.** List items absorb lazy continuation lines (and
  list-exit now mints the blank-line separator its output needs on reload); `www.` autolinks
  gain their scheme; link-reference definitions reject trailing garbage and yield to block
  openers; indented code interrupts non-paragraph predecessors; entity-shaped autolink tails
  are excluded; container nesting depth caps at 512 with byte-preserving degradation (was a
  stack-overflow crash reachable from ~2KB of input); the backtick and directive-closer
  scans join their siblings' bounds, retiring two super-linear shapes.
- **Keybinding routing.** Malformed chords fail loudly at every ingestion path (a `Ctrl+W`
  typo no longer silently steals every `w`); the container bubble honors consumer global
  disables; document-level chords gate on instance containment — multi-editor pages route to
  exactly one editor, and a sole editor yields Ctrl+F to a foreign text input.
- **Selection.** Same-path cross-block state is unmintable (the invisible-selection class);
  backward-selection entry captures the anchor, not the range start; full-column delete
  tolerates windowed-out rows; `getSelection()` reports real within-block range offsets;
  table Shift+Arrow extension walks rows and exits the table.
- **The test platform got its real oracles.** A live-tree convergence check
  (`parse(serialize(live))` structurally equals the live tree) replaces the tautological
  post-mutation round-trip assert everywhere it stood — the published conformance kits, the
  e2e bridge, and every simulation checkpoint; both kits assert rebuild identity against the
  parse; commit-family negative-controls pin that the invariant belts are actually buckled;
  the simulation gains cross-block-destructive and merge gesture families plus session
  undo-unwind and selection-validity oracles; the undo property types markdown at arbitrary
  offsets and replays redo; keyboard-extend gains its mirror-direction and dispatch-layer
  coverage; the editable-leaf tier intercepts clipboard like every other editable surface.
- **Honest gates.** `--passWithNoTests` dropped from all 21 unit scripts; the CI perf job
  measures the prod build it always claimed to; the consumer example exercises all eight
  published subpaths; the docs-pack link closure and verify-pack harden (the required list
  now derives from the exports map); four new parity lints (G4.16–G4.19).
- **Organization.** The scan/directive/conformance test suites fold under their source
  mirrors; decoration and search state move home to their feature directories; the built-in
  descriptor registrations split from the descriptor contract.
- **VR-1 resolved by exoneration.** The long-red anchor spec was measuring in the wrong
  frame — the demo harness header's re-wrap moved the whole editor 72px and the spec read
  viewport-absolute coordinates. Instrumentation proved the windowing correction holds the
  anchor to 0.22px; the spec now measures editor-relative, and a revert-check confirms it
  still catches a genuinely broken correction.
- **Ledger.** Ten `docs/issues.md` entries closed; every surviving entry re-verified this
  audit with its rationale, fix design, or falsification history recorded.

### 0.9.27 — The architecture-concern pass: five flagged designs, five recorded resolutions

A post-0.9.26 architecture review flagged the five designs most likely to be regretted after
the freeze; the owner's build-up-front posture demanded every one be attempted before the
limestone integration binds to them. All five resolved — two fixed as types, one built, one
consolidated, one exonerated by measurement (this entry is the durable record; the working
doc it summarizes was retired once resolved):

- **`SelectionPoint` is a discriminated union** (`CharSelectionPoint | CellSelectionPoint` on
  the `cellCoordinate` flag). `offset` keeps its name on both variants — near-source-compatible
  for every consumer — while cell mints carry `satisfies`-enforced construction teeth, the undo
  copy path preserves the variant, and the intra-table context-established convention is
  documented on the type. The dual-space wart no longer freezes loose at 1.0.
- **`CstNode` is a discriminated union** — per-built-in-kind arms with typed metadata behind
  `isBuiltinBlockNode`, plus the open branded-plugin arm. The one production in-place `kind`
  write (the re-parse transfer) proved vestigial and now mints-and-replaces on kind change,
  while same-kind edits keep in-place field writes — node identity is load-bearing (the
  block-list registry, height caches, and inline accessor key WeakMaps by node), now pinned by
  an identity test. Honest boundary: the branded plugin arm blocks full-union narrowing, so the
  ~90 `metadataOf` sites keep the single sanctioned funnel; the union's wins are construction
  correctness, native narrowing in the built-in sub-union, and a discriminable `NodeView`.
- **Registry reads resolve through per-instance views over global definitions.** The default
  view aliases the global reads — behavior-preserving by construction — with a harness-proven
  enablement knob (editor A renders a plugin kind raw-editable while B renders it live, one
  process); `parse` gains an additive `{ grammar }` option threaded through the content-commit
  reparse. The **SSR registrar-poison class is structurally fixed**: under a dev server a
  duplicate registration replaces with a note instead of throwing, so a re-evaluated registrar
  survives — prod and test keep the frozen register-once throw. Honest boundaries recorded for
  limestone: the initial parse stays global, inline enablement waits on layering, the
  enablement knob's public shape firms with the first real consumer.
- **The context surface consolidated**: 36 keys → three named facets (services, policies,
  document) plus the eight load-bearing per-key survivors — the container override triple,
  history (G1.4), and the scope-provided channels. Byte-identical; mounting a block component
  in a test is now one `editorMountContext()` call instead of thirteen stubs. The aligned
  `BlockComponent` probe-facet grouping is recorded as freeze-cut input, deliberately unshipped.
- **Container-raw redundancy: exonerated by falsification.** The new combined depth-x-size
  benchmark (the axis no prior fixture reached) measures realistic deep-nesting typing at
  ~1-2 ms/keystroke of ancestry rebuild — floor class, two orders below the pathological
  class — with the superlinear tail confined to adversarial shapes. The most guard-hungry
  design in the repo keeps its guards and gains its evidence.
- **Perf e2e baseline re-blessed (2026-07-16 run).** First re-measure after the 0.9.26/0.9.27
  milestones, which the 2026-06 baseline predated: many-small-blocks 10MB load 22.1s → 4.5s,
  reference-heavy 10MB load 2.5s → 1.1s, single-giant-paragraph 10MB keystroke 1.8s → 1.2s;
  the viewport-bounded keystroke band reads 2.5-4.4ms across every shape and size. Bench time
  rows keep their 2026-06-20 reference values.

### 0.9.26 — Presentation modes: the full live-preview ladder

Always-visible styled source stays the editing substrate and the default — these modes make it
a choice, not a ceiling. The reason this shipped pre-1.0 is the contract, not the feature: a
plugin can now learn the presentation mode at every tier, so nothing authored against 1.0
strands when a consumer flips to preview.

- **The mode contract.** `PresentationMode = 'source' | 'reading' | 'preview-block' |
'preview-inline'`, a live `presentationMode` prop (the `theme` shape) reflected as
  `data-presentation` on the root, and one effective-mode resolution feeding four doors: the
  root attribute, a block-facing context getter (riding the render key), a plugin-facing
  `EditorContext.presentationMode` getter + `presentationModeChange` event, and getter reads on
  the editable-leaf and inline-widget tiers. Per-tier reactivity is documented honestly — the
  block-component DOM read is point-in-time; live reaction subscribes to the event.
- **Reading mode** — markers hidden, widgets rendered, read-only. Hiding is CSS-first (the
  raw-aware walk counts lengths, not layout, so offsets survive by construction; render-path
  omission is forbidden). Read-only is structural: `contenteditable=false` kills the whole
  browser-edit-path class, with paste/commands/drag/islands/checkbox gates at their dispatcher
  seams. Selection, copy, and mouse/scroll navigation stay; lists keep rendered bullets and
  visible ordered numbers. Fully inert v1 — interactive reading (live checkboxes, details
  disclosure) is a ledgered product question.
- **Block-granular preview** — unfocused blocks hide their syntax (broad-hide + focused-reveal
  by DOM containment; the focused leaf renders full source) at zero hot-path cost: focus flips
  are CSS attribute changes, never inline-DOM rebuilds, and the caret's DOM anchor survives the
  reveal so click-landing needs no correction.
- **Inline-granular preview** — the target. Within the focused block, construct markers
  (emphasis, strong, strikethrough, inline code, links, image syntax) hide until the caret
  enters the construct's range; entry reveals the full nesting chain, leaving folds it. The
  trigger is model-layer (raw offset against the inline tree, O(nodes-at-caret),
  composition-gated) with a synchronous keydown backstop — the e2e found rapid arrows outrunning
  the async reveal and skipping hidden bytes; the backstop reveals before the step lands,
  pinned by char-by-char walks asserting every offset.
- **Caret affinity dissolved under raw-as-truth.** The roadmap anticipated stored-marks-style
  machinery; verify-first found none is needed — the caret is a raw offset, revealed source
  makes boundaries visible, and typing lands where the visible caret sits (right-prefer decides
  which construct reveals at a shared boundary). Pinned across the adversarial boundary cases
  (edge typing, adjacent constructs, fold-then-type, backspace degrade); recorded as a design
  finding rather than built as machinery.
- **The opening move paid off first**: the three caret-edge/destructive-key seams consolidated
  into one declarative edge-policy dispatch (byte-identical, full-battery-proven) with the
  trimmed `deleteGranularity`/`onEdge` policy fields re-added; G4.12 now pins the funnel, so the
  reveal semantics joined ONE dispatch instead of minting a fourth seam.
- **Guardrails caught real bugs mid-milestone**: an existing reading-inertness e2e caught a
  four-site parity miss in the mode-gate threading (fixed; the residual is ledgered), and the
  0.9.25 instruments carried into the new machinery. The simulation gained a mid-session
  mode-flip gesture with a byte-stability oracle; a11y scans cover all three new modes under
  the same ratchet; the showcase and harness routes toggle every mode.

### 0.9.25 — Inline observability: the flight recorder before the field reports

The inline layer's per-keystroke rebuilds make every inline state transient — cursor
capture/restore, reveal open/fold, widget-pool adopt/sweep, IME composition, island
application — so a field report used to arrive after the state that produced it was gone.
This milestone makes the layer observable, asserts its state machines, and pins the
composition contract directly. Built now, deliberately, before the two events that multiply
the exposure: presentation modes (which multiply the inline state machines) and the limestone
integration (the first external field-report source).

- **The interaction trace.** A ring buffer of inline-layer transitions
  (`debug/interaction-trace.ts`): rebuild + which render-key segment changed, cursor
  capture/restore/pending, reveal open/fold + reason, pool adopt/build/sweep counts,
  composition start/end, island applications, sticky capture/reset. Ships in production
  **default-off behind one boolean per site** — the perf-instruments discipline without the
  DEV strip — so a real app can arm it; disabled cost is one boolean check (perf-suite-pinned,
  byte-identical behavior). Trace entries carry primitives only — never document text.
- **Two doors.** The debug panel gains an Inline trace section riding Copy-all; consumers get
  `getDiagnostics()` on the editor instance — trace enable/snapshot plus
  `serializeDiagnostics()`, the attachable fenced-markdown field report (document source
  excluded by default; `includeSource: true` is the consumer's explicit call). A field report
  becomes: reproduce, copy, paste. The trace is process-global (two editors interleave) —
  recorded, revisited with the reveal mount-waiter keying at the freeze cut.
- **Transition assertions (G1.25–G1.27).** The pool bracket becomes explicit and asserted
  (acquire outside a beginPass/sweep bracket, unbalanced brackets), reveal transitions assert
  their illegal interleavings (fold during the settle window; the kernel precondition speaks
  on the invariant channel), and the composition window asserts end-without-start — all on
  the `invariant:` channel every e2e spec and the simulation already police. The
  pending-cursor machine ships NO assert, by proof: the render effect clears it
  unconditionally in both arms — the leak state is unrepresentable. Left-silent paths are
  recorded with evidence; a defensive bail on a legal transient stays silent by rule. The
  ledgered battery-order reveal flake now has a diagnosis channel: a reproduction names its
  illegal interleaving instead of surfacing three layers away as a caret mystery.
- **The IME composition harness** — the ledgered gap closes. Handler-level unit contract
  (real editable-surface handlers, synthetic composition sequences, faked DOM readback): no
  CST sync mid-composition, one commit at end, one undo entry, CodeBlock's `insertLineBreak`
  gate both sides. Real-browser CDP sequence (`Input.imeSetComposition`, listener-verified
  compositionstart/end — not an insertText degenerate) over paragraph, code block, and table
  cell, undo included, deterministic under repeat. Safari's duplicate-compositionend quirk is
  ledgered with a relax path; the composition sim gesture is ledgered pending.

### 0.9.24 — Enforcement hardening: the load-bearing contracts climb to types

The 2026-07 audit's two dominant bug classes — sibling-path parity and offset arithmetic
outside the shared walk — were held by dev guards, prose, and review. This milestone climbs
them to the compiler while the climb is cheap, before external code binds: a new consumer now
inherits the contracts from types, not from `culture.md`.

- **Branded coordinate spaces (G3.7).** Raw offset, ambient-inclusive DOM-text offset,
  editor-relative X, viewport X, cell index, and doc-absolute path are distinct branded types
  (`cursor/coordinate-spaces.ts`), minted only by their single-home modules; inter-space
  conversion is a named function with one home per direction; public doors keep `number` and
  brand once at the boundary, policed by a mint lint (G4.15). The pass corrected the space
  model itself: the widget-offset walk is marker-_inclusive_ — it speaks DOM-text offsets, and
  raw offsets mint at the ambient seam; the design doc had it backwards, and the brands now
  make the true model unrepresentable to violate. `SelectionPoint`'s dual-space `offset` reads
  through space-split accessors; the selection overlay's endpoint decode branches honestly by
  space. `DocPath` is deliberately narrow (the scope factories + the G1.16 entry are branded;
  op-family composers stay `number[]` with the runtime guard as the belt — ledgered).
- **The closure matrix is a required type and an executable battery.** Registration carries a
  `closure` block answering all nine cross-cutting systems (implemented / inherit-default /
  not-supported) — a blank cell is a compile error, G1.24 cross-checks cells against the
  descriptor, and a `conformanceFixture` rides the declaration. The `aragonite/testing` kit
  generalized: registering a kind ENROLLS it — headless cells (round-trip, merge, clipboard,
  undo) execute at the unit gate, a profile custom check is refused on a cell not declared
  `implemented` (so a bare mode revert bites), and the bundled lockstep anchors on the plugins
  directory listing. A browser sweep executes the three mounted-DOM columns (focus walk,
  selection paint, search paint) per registered kind from the live registry. The audit-then-
  execute sequence earned its keep immediately: the declared-vs-real audit caught a false
  table clipboard cell (a real rectangular sub-table copy path had been declared
  inherit-default), the sweep ledgered two render-primary search-paint gaps (mathBlock, toc)
  as two-sided ratchets, and the sweep's exact-source settle fix exposed that the tableRow
  rows had been silently sweeping the previous kind's document (the harness's same-value
  `setSource` is a `$state` no-op — each load now varies leading trivia).
- **Readonly-by-layer CST views (G3.8).** `NodeView`/`DocumentView` are bytes-scoped
  deep-readonly views — exactly G1.9 as a type: serialized bytes readonly, the
  `childIds`/`ownerEpoch` bookkeeping writable. Components, the decorations engine, and the
  entire plugin surface (`EditorContext.document`, `DecorationSource.provide`,
  `BlockComponentProps`, descriptor read hooks) read through views; constructors and writers
  (`parse`, `tryOpen`, `rebuildRaw`, the factories) keep the mutable type; the only
  view→mutable door is the unshare seam plus the commit ceremony, policed by a door lint
  (G4.13) and an annotation-parity lint (G4.14). Every in-repo consumer compiled unchanged —
  the byte-write discipline was already clean; it is now a compile-time guarantee, with the
  DEV integrity oracle kept as the runtime belt.
- **Sibling-path parity lints (G4.10–G4.12).** Source-scan guards where funnels can't exist
  yet: plugin pack surface (every `src/lib/plugins/<name>` has exports-map + verify-pack
  entries), paste-transform two-site parity (a clipboard→parse route born without the pipeline
  fails at birth), and caret-edge destructive-key seam parity (no unguarded fourth seam;
  consolidation stays presentation-modes work).

### 0.9.23 — Demo groundwork: bundled plugins ship as package subpaths; `/` is the showcase

The structural half of demo polish, pulled forward so everything after it lands into final
structure: the limestone integration's developer meets the repo through the demo and the
plugin folders, and both now read as product, not dev artifacts.

- **First-party plugin packaging.** The bundled tier — admonitions, details, latex, mermaid,
  toc, highlight-occurrences — moves into the package at `src/lib/plugins/<name>/`, shipped as
  `aragonite/plugins/<name>` subpath exports (one version, one tarball, exports-map
  encapsulation). Dev fixtures (callout, memo, block-badge, fold, doc-stats, ghost-text,
  sim-mark) stay harness-side; the tier split is recorded in the packaging README.
- **Engines stay out of consumer bundles.** latex and mermaid split into engine-free cores and
  `/renderer` adapter subpaths: `aragonite/plugins/latex/renderer` is katex-backed and carries
  the one sanctioned CSS side effect (listed in `sideEffects`); `aragonite/plugins/mermaid/renderer`
  dynamic-imports mermaid. `latexPlugin({ renderer })` requires its renderer (math has no honest
  engine-free fallback); `mermaidPlugin()` stays legal and renders the fenced source statically.
  katex and mermaid become optional peerDependencies. Verified in built `dist`: engine
  references exist only in the adapters.
- **Bundled plugins are external-shaped, by guard.** Everything under `src/lib/plugins/`
  imports only the public authoring barrel — enforced by a new import-boundary source-scan
  lint with a per-adapter engine allowance. `getContentRange` joins the plugin barrel (toc is
  its consumer); the css-ownership lint covers both plugin roots.
- **The showcase route.** `/` mounts the editor with all six bundled plugins over a document
  covering every built-in block kind — the basic shell; the pitch content stays a later
  milestone. `/test/*` is uniformly machine-facing: the `?plugins=1` toggle and its badge
  retire, and `/test/editor` always renders the plugin-free default the batteries depend on. A
  showcase smoke spec (DOM-only, no test bridge) pins that every bundled plugin renders.
- **The copy-source sync retires.** `examples/consumer` installs bundled plugins from the
  tarball subpaths; the sync manifest shrinks to callout, which stays as the external
  _authoring_ validator. The consumer smoke now exercises the exact import shape limestone
  will use.
- **Tests move with their plugins** — bundled-plugin unit suites mirror the new source tree at
  `test/plugins/<name>/`; fixture suites stay flat; e2e specs route-repointed with zero
  behavioral edits. One new seam guard: the math injection seam pins that inline and display
  rendering thread their own `display` flag (the memo keys on it — cross-serving would swap
  block and inline HTML silently).

### 0.9.22 — Decorations + the public rect API: the extension surface completes

Decorations — view-only annotations over content a plugin does not own — were the one plugin
class the platform could not express, and the **public rect API** they bottleneck on had no
consumer door either. Both ship here, and **search migrates onto the decoration engine as its
first client** — proving the surface against a built-in before any plugin binds it. This closes
the last extension-surface gap; what remains before the freeze is validation depth.

- **The engine.** A decoration source is a pure `doc → Decoration[]`, memoized — no state API,
  nothing to map forward (positions are `(path, offset)` into a CST re-derived every edit). One
  edit epoch splits the two invalidation reasons: `notifyEdit` bumps the epoch and re-runs every
  source (the document changed), while a source handle's `invalidate()` re-runs just that source
  without the bump (its own state changed) — so a memoized source distinguishes "rescan" from
  "cheap remap". Each source runs contained: a throw keeps its prior decorations and surfaces as
  an attributed error, never blanking the view. **G1.23** forbids a source running inside the
  commit ceremony — it would read a half-published tree — so the re-run defers a tick past the
  edit event.
- **Four types, tiered paint.** `mark` (a positioned overlay per visual line, carrying the
  source's class), `widget` and `replace` **islands** (in-flow, applied in the prose render
  path), and `block` (whole-block). A mark whose range crosses dimmed markers, soft wraps, or
  ambient spans splits into one rect per fragment through the partial-rect measurement — the same
  geometry the rect API exposes.
- **Island editing semantics.** An in-flow widget or replace island defines caret and delete
  behavior at its boundaries (the atomic-boundary pin); an island that targets a non-prose block
  dev-warns at the source seam instead of silently rendering nothing.
- **The public rect facet, on both doors.** Consumer-side `editor.getRects()` and plugin-side
  `editor.rects` (from the `onEditor` context) return viewport-space geometry: a block's box, an
  inline range's rects, and the partial-rect split — the geometry a suggest popup or a selection
  toolbar needs, previously locked inside the cursor layer.
- **Search as client #1.** The find bar now rides an `editor:search` decoration source instead
  of the bespoke `MatchOverlay`, which is retired; the per-ancestor match-bucket read and the
  other memo behaviors it depended on are pinned as regression guards on the shared engine path.
- **The childless-opaque paint gap, closed.** A childless opaque container (mermaid) scanned no
  decorations and painted none — its endpoint box was invisible to the partial-rect walk; both
  the scan and the paint now include it, so a decoration over such a block lands.
- **Consumers, one per validated surface.** Dogfood sources for every type — highlight-occurrences
  (mark), block-badge (block), fold (island) — plus the selection-toolbar **consumer recipe**
  built through the public doors only, and the standing simulation source now asserted live. Each
  pins a type or a door end to end.
- **Guardrails.** An adversarial round-trip **property** proves a decoration never changes a byte
  of the source (reaching snap-outward ranges and ambient classes); **G1.23** and the **perf
  ceilings** hold the zero-keystroke-cost default — no source registered means no per-edit work —
  and cap the per-edit source cost.
- **Barrel + ledger.** The `Decoration` union, `DecorationSource` / `DecorationSourceHandle` /
  `DecorationRegistry`, and `EditorRects` join the public barrel and the plugin subpath. The honest
  remainders — islands inside table cells, single-block selection ranges, same-cell match dedupe,
  and simulation gestures for decorations — are ledgered in `docs/issues.md`.

**Posture shift, recorded as doctrine:** interfaces ship at industry breadth pre-freeze;
validation is added test consumers, never trimmed scope. A surface without an in-repo consumer
gets one written for it — a dogfood is validation, not a gatekeeper — and the surface is never
narrowed to what today's consumers happen to exercise.

### 0.9.21 — The plugin context spine: per-instance editor handle

`setup()` took no arguments and ran once per process, so a plugin could reach no editor: no
derived state, no edit reaction, no per-instance config. The context spine closes that class —
the one remaining extension-surface gap besides decorations (see `docs/roadmap.md`) — and two
dogfoods validate it end to end.

- **`setup(ctx)` + `onEditor`.** `setup` now receives a `PluginSetupContext`; `ctx.onEditor(cb)`
  registers a per-`<Editor>` callback that receives an **`EditorContext`** — `editorId` (stable
  per mount), a live `document` getter, a subscribe-only `events` view (`Pick<EditorEvents, 'on'>`
  — no plugin-visible `emit` to freeze), and typed `options`. The callback may return a disposer,
  run at unmount. Registration is synchronous-only (a leaked context throws), and `definePlugin`
  gained an `<Options>` generic so `editor.options` reads typed with no cast. Derived state is now
  a plugin-owned `Map` keyed on `editorId`, not a platform field — the state-API question is
  answered by making one unnecessary.
- **Per-instance options.** The `plugins` prop accepts a bare unit or `{ plugin, options }`
  (`EditorPluginEntry`), so two editors sharing one process-global registration can still run
  different options — the split-pane case. Same-name/different-identity stays first-wins with a
  dev-warn. The factory-closure pattern (per-instance config smuggled through the plugin factory's
  argument) is now an **anti-pattern** for anything two editors would vary; a factory argument
  stays correct only for a process-global dependency like a render engine.
- **`registerGlobalCommand`.** Mints a process-wide command whose handler receives the dispatching
  instance's `EditorContext` — the _same_ object `onEditor` hands out, never a second context — so
  an editor-scope action (open a panel, insert the date) fires regardless of focus. An optional
  chord binds in the **plugin-global tier**, which resolves last in precedence; built-in chords and
  the search chords (`Mod+F` / `Mod+H`) are unstealable and a collision throws before the mint. A
  handler throw is contained as an `error` of origin `command`, attributed to the owning plugin.
- **`BlockCommandContext.editor`.** A block command now reads the same `EditorContext` for
  document/events/options. The field is the pinned shape: document mutation arrives later as
  _further fields here_, never a second context object — the growth-as-fields decision the roadmap
  flagged as the one genuine breaking risk.
- **`BlockComponentProps.document`.** Every block component receives the read-only root document at
  any nesting depth, so a table-of-contents block can see the headings above it. The `toc` dogfood
  reads it at a nested depth — the validator that pins BlockHost's delivery on both branches.
- **`estimateHeight` descriptor field.** An optional O(1) per-kind height estimate the oracle
  consults after the collapse probe, before the prose char-wrap default — so a Mermaid diagram is
  estimated at its skeleton height instead of ~40px and scroll is right before it mounts. The
  measured cache still supersedes; a collapsed container still estimates at one chrome row.
- **Two dogfoods + a simulation detour.** `doc-stats` (onEditor + a plugin-owned stats map + a
  global command + per-instance options) is the context-spine validator; `toc` is the document-prop
  validator; the simulation gained a global-command detour, so the corruption oracle now watches the
  new dispatch path.

### 0.9.20 — Plugin-platform hardening: the evaluation program, pulled forward

A full platform evaluation (two audits: API/contract; every reference plugin read as a
consumer), then everything it found shipped pre-freeze in one owner-directed program — so the
limestone integration and the second clean-room run validate the improved surface, and no
early adopter hits a wall we already knew about.

- **Contract ambiguities closed (P0).** `augmentBlockKind` gains an ownership gate — a plugin
  can no longer silently overwrite a sibling plugin's kind descriptor (red-first). Minted
  block commands now dispatch on the plugin editable-leaf tier through the same
  `runMintedCommand` seam as the container-bubble path (previously: silent dead-key). A
  `'command'` error origin with containment at both dispatch choke points — a throwing plugin
  handler becomes an attributed error event, never an uncaught window error. New
  **`aragonite/testing`** subpath: one `resetPluginPlatformForTests()` aggregate (env-guarded,
  barrel-tested), so third-party authors get the isolation the in-repo dogfood tests always
  had; plugin-guide gains the testing recipe.
- **The command→component channel** (the #1 recorded authoring wall): factory-level
  `commandHooks` getter threads plugin UI hooks into `BlockCommandContext.hooks` on both
  tiers — no node-keyed map, no lifecycle cleanup; the dispatch context is built inside the
  owning component's factory. Mermaid's hand-rolled `uiHooks` bridge deleted (net negative
  LOC).
- **Renderer memo primitive**: `createBoundedMemo` (one signature unifying sync clone-on-read
  and async promise/rejection caching) on the barrel; latex + mermaid migrated off their two
  divergent local LRUs; the guide consolidates the renderer recipe (factory-option DI, error
  fallback, engine-CSS ownership).
- **Ceremony floor cut**: `createDirectiveRebuild`, `chromeChild`, `definePluginBlock` —
  the copied rebuild/title-child/registration ceremony deleted from every dogfood. The
  component re-export block is deliberately NOT collapsed (a capturing helper would
  reintroduce the getter-snapshot corruption class); promoted documented→guarded via a
  `satisfies ContainerBlockComponent` completeness check in every container dogfood, with the
  platform-collapse idea ledgered for 1.2. Centralizing the rebuild also closed a CRLF gap:
  title-mode directive containers had no line-ending-fidelity coverage.
- **Folklore became contract.** `OPENER_PRIORITIES` exported and single-sourced (built-ins
  register FROM the constant — drift is a compile error) with the guide's ladder table; the
  theme-token manifest published (both-themes existence guard, the dead
  `--color-text-secondary` reference fixed, fallback drift reconciled to dark-base values);
  a new lint scan extends CSS-token ownership to the dogfood plugins.
- **Docs as one current snapshot.** plugin-contract reconciled (shipped items no longer
  "planned"; pivot annotations rewritten; `getInlineContent` reframed as internal); the
  inline tier honestly contrasted with the block surface (no keymap/commands/node metadata);
  the **tier × subsystem closure matrix** added to the contract as a required checklist —
  every extension tier × every cross-cutting system (parse, focus, merge, selection paint,
  search paint, reorder, undo, clipboard, simulation), gap cells marked from the ledger.
- **The consumer example works from a fresh clone**: `src/plugins/` stays sync-generated but
  self-heals via pre-hooks; the rotted 0.9.16 tarball pin replaced by a version-agnostic
  `file:../..` link (smoke-verified to still install the real packed tarball in CI); seven
  stale root tarballs removed; quickstart documented.

### 0.9.19 — Selection/focus completeness + the issues-ledger work-down

The 0.9.18 follow-through (owner-directed): every block state selects, focuses, and deletes like a first-class citizen, and the known-issues ledger shrank from 19 entries to 7 — each remainder now a genuine keeper with a target or rationale.

- **A childless opaque container inside a cross-block selection paints the full-block overlay.** SelectionOverlay's container gate deferred painting to child hosts that don't exist for a childless plugin block (mermaid showed nothing while selected); the gate now defers only when child hosts exist. Same-class gap in MatchOverlay recorded (design call pending).
- **The error/loading/no-renderer mermaid states are no longer caret traps.** Each non-rendered steady state mounts a focusable surface; a `composeWholeBlockFocusSurface` choke point falls back to the block's box (devWarn, once) so no future plugin render-state can strand the caret; committing a source fix from the error card hands focus across the async card→viewport swap (third latent defect, found while pinning the recovery path).
- **Range-delete ceremony unified at one choke point.** The table branch emptied covered containers child-by-child before deleting them — corrupting any undo snapshot holding the detached node (red-first) — and now shares the chrome branch's subtree-root + identity-gated ceremony (`range-delete-ceremony.ts`); the prose branch consumes the same gated delete.
- **Structurally-noop commits no longer mint dead undo entries or events** — opt-in discard from the structural cores (metadata commits legitimately no-op and still commit), rolled back as the benign twin of the commit-throw path.
- **Directive rebuilds preserve CRLF** — the authored line ending rides directive metadata through `serializeDirective` (generic, callout, admonitions; details' HTML rebuild remains ledgered).
- **Attribution axes fixed after ~11 versions**: the 9 failing axes focused the document's LAST block, which windowing had unmounted — keystrokes landed on `<body>` and the settle hung; the ledger's byte-length diagnosis was falsified. Axes now focus an asserted-mounted block 0 (harness-only; the perf gate already did this — sibling-path parity).
- **Simulation coverage caught up with 0.9.18**: caret-entry reveal walk-through and edit-commit detours, mermaid focus/two-step-delete/Enter detours — plus a silently-broken `editInlineMath` gesture (its click missed the KaTeX hit-target; the content-agnostic oracle never noticed) fixed with byte assertions. MatchOverlay cell search reads a per-ancestor bucket instead of scanning all matches; `TableCellBlock` gained the sibling pending-cursor guard; LaTeX A2 (edit one of N re-renders only that one) is now integration-pinned.
- **Ledger hygiene:** conformance adjudications, the watcher promotion rule, and the `deleteGranularity`/`onEdge` re-add shapes moved to their code/contract homes; stale fixed/record entries removed; new entries: dev-server SSR registrar poison (root-caused this session), MatchOverlay gap.

### 0.9.18 — Caret-entry UX: widgets reveal, opaque blocks focus

Two owner-reported caret UX defects on the plugin surfaces, each fixed as its class.

- **Horizontal caret entry into a reveal-capable inline widget opens the source reveal** (Obsidian model). ArrowLeft/Backspace from the right or ArrowRight/Delete from the left of inline math (and directive text widgets) reveals the raw source with the caret at the entered edge; walking out folds it. Replaces the widget-selected park — a state with **zero visual rendering** for math (the caret vanished, and a second Backspace silently deleted the whole formula). The dispatch keys off the same `revealSource` policy the click path already used, at one seam (`enterWidget`) covering all four sibling entry sites, including the cross-block edge landing (`selectEdgeWidget` renamed `enterEdgeWidget` — it now enters per policy). Images keep select-then-step / select-then-delete; Shift+Arrow extension never reveals; the now-dead Enter-to-reveal branch is deleted.
- **Opaque childless plugin blocks are whole-block focus targets** (`blockFocus: 'whole-block'` descriptor + a focus-el getter on the container factory — public surface, mermaid as consumer). Arrows stop on the block with a focus highlight instead of gliding past; Backspace at the start of the block below (or Delete above — the forward twin, fixed together) focuses it first, a second press deletes in one undoable commit; Enter inserts a paragraph below; Alt+Arrow reorders; clicking the diagram then Backspace deletes; keys from the plugin's own edit textarea never reach the block affordances. Previously the block was undeletable except by selection sweep: its `not-mergeable` + descriptor-editable config dead-ended the merge fallback on a childless container.
- **The editable-container backfill no longer stuffs a phantom paragraph into childless-by-design kinds.** Pre-existing: every parse→load backfilled the opaque mermaid container with a `paragraph {raw:'\n'}` child, permanently violating opaque raw↔children faithfulness — latent because no commit ever ran the checker over the node until the new Enter/reorder gestures fired `[invariant:opaque-stale-raw]`. Whole-block-focus kinds now skip the backfill (the block itself is the caret target). Miss-analysis: the backfill had unit pins for list/blockquote but none asserting it _declines_ a kind whose design is childless; the invariant existed but nothing committed over a loaded mermaid node in any suite.

### 0.9.17 — CI + contributor hardening, showcase quality

The pre-freeze collaboration prep: the repo a second developer clones has green sharded CI, a contributor front door, and a showcase whose plugins behave.

- **CI hardened.** The Playwright battery shards 4-way per run; a prod-build `perf:check` job gates the keystroke rows (environment-scaled ceilings via `PERF_RUNNER_SCALE` — local stays the tight unscaled gate); the invariant-watcher fixture is adopted by every e2e spec, so any `[invariant:…]` fire fails the spec that triggered it (the one intentional-fire suite opts out). The watcher paid for itself on its first CI run — see the detached-scope fix below. Attribution axes stay recorded diagnostics outside the gate (`docs/issues.md`).
- **Contributor front door.** Minimal `CONTRIBUTING.md` (setup, gate tiers, commit + culture pointers), a `docs/README.md` index, self-contained `docs/contributing/code-style.md` / `docs/contributing/commit-conventions.md`.
- **Editor fixes, each red-first.** Enter at content offset 0 splits instead of no-op (text kinds) or byte corruption (fenced-code opener; a third unguarded sibling seam found and closed). Opaque plugin containers decline nested reorder — dragging an inner block no longer teleports the whole container, and chrome rows carry no dead drag handles. The multi-scope commit no longer rebuilds or invariant-checks scope nodes its own mutation detached (the watcher-surfaced CI-only stale-raw fires). KaTeX renders once (`katex.min.css` beside the injected renderer — the stylesheet is documented as the consumer's responsibility). Inline-widget reveal folds on caret escape: pointerdown-owned click gesture, raw-offset boundary-inclusive containment, tick-surviving escape check, one-gesture widget switching.
- **Showcase quality.** `?plugins=1` carries the reference plugins only (fixture dogfoods classified in `src/routes/test/plugins/README.md`); admonitions/details moved to restrained gutter-rail chrome with the untitled-title wrap fixed; mermaid gained focused-only zoom/pan, double-click edit, Tab-as-indent, theme-token toolbar and overlay.

### 0.9.16 — The editable-leaf tier

The plugin platform's last big tier: **`createEditableLeaf`** on `aragonite/plugin` (pre-freeze), a text-editing plugin block with native caret/IME/undo/cross-block-selection parity — the container factory's sibling for leaves.

- **The factory.** Getter deps (`node`/`index`/`path` + `getEl()`), its own context reads — a plugin never touches an editor context key. Two modes: `plain` (always-editable, per-keystroke commits, prose undo batching, factory-owned view sync with the Chromium trailing-newline caret anchor) and `render-primary` (component-owned render↔source swap; the whole reveal→edit→blur cycle is one undo entry). Returns the `BlockComponent` surface pre-guarded for one-line re-exports, the source-element handlers, `reveal`, and `commitSource`. Block math migrated onto it as the render-primary validator — its 17 `$lib` deep imports collapsed to the public barrels, and it **crossed the package boundary** (sync manifest + consumer route + smoke; katex was already a consumer devDependency), closing the recorded block-math exclusion. A minimal `%%` memo harness kind validates plain mode e2e (typing, traversal, undo batching, selection sweeps).
- **The stuck-fence class, killed at the choke point.** A block whose edited text parses to **multiple blocks** now structurally replaces itself with all of them — the first keeps its slot identity, the caret follows the edit position into whichever block it falls in. The cram — a same-kind reparse silently writing multi-block text into one node's raw, block math's "stuck error until reload" — was reachable by built-ins too (paragraph hard-break + interrupter line, fenced-code early close), so the fix landed at the tree-op choke point and both commit bodies, not in the factory; the splice runs inside the commit ceremony with ids, refs, and snapshot stamping synced. A blur-commit no longer yanks the caret back when focus has moved on, the code block's pending-cursor restore gained the guard the split made reachable, and the split/merge reparse paths dev-warn if they ever meet the multi-block shape (sibling-path watch).
- **Keybinding widening rides along.** `KeybindingOverride.kind` widened to `AnyBlockKind`, so a consumer can scope a chord to a plugin kind via its exported kind constant.
- **Smalls: barrel re-exports, parity mirrors, memo caps.** The CommonMark fence matchers (`matchFenceOpen`/`matchFenceClose`, now capturing the verbatim indent/info bytes a byte-exact rebuild needs) and `normalizeLineEndings` joined `aragonite/plugin` — the mermaid reference plugin dropped its fence-rule copy for them, striking two wall-ledger items. Two sibling-path-parity mirrors landed: the inline scanner's fast-bail `w`/`W` arm probes the plugin-trigger registry like its `:` sibling, and `lineInterruptsParagraph` carries the grammar-read seam duties (registration flush + consumed latch) its `getOrderedOpeners` sibling does. The dogfood math and mermaid render memos are LRU-bounded.

### 0.9.15 — Mermaid reference plugin

The first **reference plugin**: a `mermaid`-fence diagram block written as a first adopter would write it — every import from `aragonite/plugin` — validating the "render-primary block with plugin-owned editing" recipe for blocks whose content renders as a picture (diagram, canvas, embed) rather than text.

- **The recipe, validated live.** A fence-claiming opener priced ahead of `fencedCode` (a superset matcher, so the claim must run first; declining returns the fence untouched); an **opaque container with no children** whose code and fence bytes live in typed plugin metadata, `rebuildRaw` re-emitting the exact bytes; edit mode as a plugin-owned `<textarea>` committing through the container factory's `updateOwnMetadata` — one undoable entry, byte-exact in `getSource()`. The renderer is injected (`mermaidPlugin({ renderer })`; `mermaid` stays a devDependency), memoized per code text, parse failures rendering a legible inline error; absent a renderer the block shows its code statically. Pan/zoom on the rendered SVG and a fixed-position focus overlay (button + a minted `mermaid.focus` command on `Mod+M`, Escape closes) prove interior interactivity inside the component's own DOM. Uninstall safety is by construction — without the plugin the same bytes parse as plain `fencedCode` — pinned by a fast-check round-trip property over adversarial fence shapes (CRLF, `~~~`, missing closer at EOF, indented fences, unicode) in **both** install states. Written up as the plugin guide's render-primary recipe.
- **Findings, honestly.** `updateOwnMetadata` was reachable and sufficient — the anticipated metadata-commit gap did not exist. Two real walls: the built-in fence matcher isn't on the barrel (a fence claim reimplements the CommonMark fence rules), and a childless container dead-ends the factory's caret traversal with no public focus-actions seam — the reference block ships `focusable: false` (arrows glide past; mouse and commands reach it), and block commands need a plugin-owned node→component bridge for view-state (no component channel on the command context). The general editable-leaf tier remains the roadmapped answer for editor-native code editing.

### 0.9.14 — Component-portal inline widgets

A plugin can now supply a **Svelte component** as an atomic inline widget instead of hand-building DOM — the recommended inline-widget path — made churn-safe under the editor's rebuild-everything-per-keystroke render by a keyed reuse pool.

- **The `component` descriptor field.** `registerInlineWidgetKind` accepts a `component` (mounted with frozen `{ inline, source }` props) as an alternative to `buildWidget`; declaring both throws, naming the kind. The render layer wraps the component in the atomic island — stamping the `data-inline-widget` / `data-source-*` / `contenteditable=false` marker attributes the cursor and selection machinery key on — and mounts it through an injected portal builder, so `core/` stays framework-free. `InlineWidgetComponentProps` is on the `aragonite/plugin` barrel.
- **The keyed reuse pool.** One live instance per `(kind, source)` survives a block's per-keystroke rebuild: typing next to a widget adopts its instance (offsets re-stamped) rather than remounting it, and an instance is remounted only when its source text changes. `mount`/`unmount` from Svelte enter the repo for the first time, contained to this seam; a synchronous mount throw is caught and routed to the editor's `error` channel (`origin: 'render'`, by path), the widget falling back to its raw source. The pool is imperative string-keyed state, never reactive — the render path reads no cache. Wired on both render surfaces (paragraph prose and table cells); the source-reveal cancel restores the exact element it detached, so byte-identical duplicate widgets and mount identity survive reveal→Escape.
- **KaTeX inline migrated as the validator.** Inline `$…$` renders through a `MathInline` component instead of the hand-built shell; the injected renderer (`latexPlugin({ renderer })`) reaches it by module wiring, and its memoization still spans the document. The migration proved the seam end-to-end: adoption keeps a formula's mount identity stable across adjacent typing and mints a new one on a source edit.

### 0.9.13 — The plugin unit + paste conversion config

The authoring registrations gain an installable **unit**, so a consumer wires an extension by passing it — not by hand-ordering `register*` calls behind idempotence guards.

- **`definePlugin` + `plugins` prop.** `definePlugin({ name, setup })` packages a plugin's global registrations; the editor's set-once `plugins` prop installs each once per process, before the instance's first parse. `installPlugins` on the main barrel is the editor-less entry for `parse()` pipelines; `isPluginInstalled` probes an install. Semantics: once per process keyed by name — same-identity re-install no-ops, same-name/different-identity is first-wins with a dev-warn (`name@version` when versioned), a failed setup stays failed (reload to retry). Kind declarations made during a setup are attributed to their plugin, so a duplicate-registration error names the first declarer.
- **All four dogfoods + the consumer examples migrated.** Callout, details, LaTeX, and admonitions are factory exports now (`calloutPlugin()`, `detailsPlugin()`, `latexPlugin({ renderer? })` — LaTeX gains renderer injection — `admonitionsPlugin()`), each installed through the prop; the boundary-clean consumer examples install the same way. Per-plugin config rides the factory, and the unit owns idempotence — the per-call registration guards are gone from the authoring model.
- **Staggered mount pinned by e2e.** A second editor can mount carrying a plugin the first never had: the late install serves the new editor's own parse, while the already-parsed editor does not re-parse (the late registration dev-warns).
- **Content-keyed paste transforms.** `registerPasteTransform` records a named, pre-parse rewrite of pasted plain text — run in install order at every paste site, each declining (`null`) or replacing the clipboard text before the parse. Paste-scoped and content-keyed (distinct from the still-internal, target-kind-keyed `registerPasteSurface`), attributed to the owning plugin, with a dev-warn on a non-idempotent transform to catch paste feedback loops. The admonitions dogfood migrated its GitHub-alert → `:::name` conversion onto it (fence-safe, parse-scoped); the host convert button stays for loaded documents. Closes the clean-room build's one honest gap — the conversion-config seam the `registerPasteSurface` rejection pointed to, shipped a milestone early.
- **Docs reconciled.** The plugin guide teaches the unit as the authoring model, the consumer guide gains a Plugins section, and the plugin contract moves the `plugins` prop from designed-ahead to shipped pre-1.0 (declarative manifest, scaffold, hot-reload, and reference fleet stay 1.2).

### 0.9.12 — Clean-room freeze validation

Roadmap items 1+2, completed. The plugin API's _discoverability_ — what the DX thesis actually rests on — tested under third-party conditions, and the package boundary now carries the plugin surface as a permanent gate.

- **The clean-room build.** A walled-off author with ONLY the packed tarball and the public docs pack built a full admonitions extension: five directive kinds, editable titles, per-kind styling, an undoable kind-switch chord, GitHub-alert conversion, byte round-trip including the plugin-uninstalled fallback — one support question in the whole run, zero dev-console warnings. Promoted as the third reference extension (`src/routes/test/plugins/admonitions/`) with its own e2e battery on the new shared plugin-spec helpers.
- **The paste forcing function fired, honestly.** `registerPasteSurface` exposure **rejected** with evidence: the target-kind-keyed hook cannot serve content-keyed pre-parse conversion, and its type closure drags commit-coordinator machinery public. The missing seam is the 1.2 conversion config — now empirically validated by a real consumer need — and the feature shipped on the documented document-rewrite pattern (`getSource()` → transform → `source` re-sync) instead.
- **Package boundary gated.** Every boundary-clean dogfood (callout, details, inline math, directives, admonitions) builds and runs through the packed tarball in `examples/consumer` — a sync step with a fail-loud `$lib` rewrite gate, per-extension smoke specs with plugin-discriminating assertions, and a dev-guard project proving the devWarn channel crosses the boundary under `vite dev` (and stays silent in a production build). Block-math stays repo-side by design (post-1.0 editable-leaf dogfood; recorded in issues). Tarball contents audited: encapsulation is exports-map-level, kept deliberately.
- **The public docs pack.** `docs/guide/plugin-guide.md` — the authoring entry point, every barrel export covered and pinned by a coverage guard test — plus a pack builder with a dead-link validator (minted after review caught the wall-grep's blind spot). Support-channel findings shipped as docs: the mutation/paste boundary, the serialize composition contract, the chord model, chrome empty-state guidance, and directive-name first-wins arbitration. The callout dogfood dropped its one deep import via the new public `isDirectiveRegistered` probe.

### 0.9.11 — The `:::name` directive primitive

Roadmap item 1 (sub-project B), completed. One shared opener owns all `:::`/`::`/`:` fences and dispatches by name into the editor's kind system — so N plugins never collide on opener priority. The remark-directive model, adapted to the CST's byte-lossless round-trip.

- **Three tiers, one grammar.** Container (`:::name … :::`, nested block children), leaf (`::name`, single-line block), text (`:name[label]{attrs}`, an atomic inline widget with source-reveal on focus). Colon count is the tier boundary; container nesting uses fence-length, like fenced code.
- **Dispatch by name, lossless fallback.** A registered `(tier, name)` resolves to the plugin's own first-class kind (full descriptor power); an unregistered name round-trips **byte-for-byte** through a generic fallback kind and renders generically — a document survives its plugin being uninstalled. `registerDirective` validates per tier (container requires a factory, text is kind-only).
- **Public activation.** `activateDirectives()` on `aragonite/plugin` — an explicit, idempotent, call-based activation (no magic side-effect import); a barrel import alone never claims `:::`. The `:::note` callout dogfood migrated onto the primitive (its hand-rolled opener deleted), proving the primitive subsumes the per-plugin-opener path.
- **Proven byte-lossless.** A `fast-check` adversarial round-trip property (all tiers, nesting, non-ASCII, registered + unregistered) with a rebuild-inverse that catches faithless fence-byte capture, plus a directive simulation gesture putting the surface under the corruption oracle. `parseDirectiveAttributes` is an opt-in `[label]{attrs}` reader. Authoring guide at `docs/guide/directives.md`.

### 0.9.10 — Inline-widget editing registry + KaTeX

The third plugin authoring seam: the image live-widget path is generalized so a plugin inline kind gets atomic caret-addressing, with KaTeX as the driving first-party consumer.

- **`AnyInlineKind` widening + inline-widget editing registry.** Plugin inline kinds thread through the model (mirroring `AnyBlockKind`) via `INLINE_KIND_TABLE` and an unknown-inline fallback; `registerInlineWidgetKind` / `augmentInlineWidgetKind` carry per-kind editing policy. The widening the roadmap flagged breaking-if-deferred-past-freeze is decided.
- **Inline-syntax recognition hook.** `registerInlineSyntax` hands the scanner a trigger character and a recognizer — gated (dormant unless registered, conformance byte-identical), the designed seat for the 1.2 inline-syntax consumers.
- **Shared source-reveal editing primitive.** Atomic inline widgets contribute raw bytes via `data-source-start`/`-end`, are caret-addressable only at their edges, and reveal editable source on focus (caret/tick core + injected swap).
- **First-party KaTeX extension (dogfood).** Inline `$…$` (select→reveal-source) and block `$$…$$` (render-primary, source-on-focus); renderer injected, not bundled — verified out of `dist`. Nine interface findings routed to `docs/issues.md` + `plugin-contract.md`; `deleteGranularity`/`onEdge` trimmed as unconsumed (re-add additively with the inline-entity consumer).

### 0.9.9 — Inline scanner rework: the CommonMark delimiter/bracket-stack pass

Roadmap item 1, cut over whole. `parseInline` is a single left-to-right scanner (`core/inline/scan/`) — character dispatch feeding a delimiter stack (flanking, `openers_bottom`, original-run-length multiple-of-3) and a bracket stack (innermost-wins links, spec destination/title parsing) — and the staged pre-pass pipeline is deleted.

- **Deliberate-only conformance.** Baseline 71 entries / 11 classes → 9 / 3, each with a recorded reason: astral flanking (we follow the spec's code points; commonmark.js reads UTF-16 units), GFM bare autolinks (the reference is CommonMark-only), and image alt as raw label bytes (the display model). Six classes converged outright; zero previously-agreeing inputs regressed across the full corpus. Two audited normalizer reconciliations (spec §6.1 code-span folding, §6.8 softbreak trimming — aragonite side only, the reference AST is already spec-folded) carry the styled-source byte model.
- **Proven before cutover.** The full unit suite passed against the new scanner under a temporary flip with every discrepancy triaged; the 0.9.6 inline stopgaps retired structurally (the link-in-code-span corruption class and the delimiter-rule patches are unrepresentable in the stack architecture; scan bounds live in the shared cores). A total-coverage property (G2.11) pins the node contract — every byte in exactly one node's range.
- **Faster:** ~2.2× the old pipeline over the slice corpus; every `perf:check` gate row at or better than pre-cutover. The scan dispatch table is the designed seat for the 1.2 inline-syntax hook; nothing exported yet.

### 0.9.8 — Conformance harness + registry hardening

Roadmap item 1's de-risk step and item 2 in full: the inline-scanner rework now has its convergence meter, and the registries limestone will bind to fail loud at the registration seam.

- **commonmark.js conformance harness** (`src/lib/test/conformance/`). Both parsers normalize to one minimal inline shape — unmapped constructs throw, and deliberate reconciliations are recorded in the baseline's audit array — diffed over three corpus strata (inline-only spec examples, brute-force enumeration, seeded random). A like-for-like guard (commonmark sourcepos full-input-span) skips inputs the reference's _block_ layer trimmed or consumed, with per-reason skip accounting, so every divergence is inline-semantic. Two tiers: a deterministic slice rides `npm test` against a committed baseline that fails closed in **both** directions (new divergence fails; stale entry fails until removed), and `npm run conformance:full` is the env-gated sweep meter — 182,160 inputs compared, producing the scanner-rework work list. The reference is pinned exact at commonmark 0.31.2; bumping it is a deliberate re-bless.
- **Registry coherence moved to the registration seam (G1.17).** The startup-once, dev-only sweep became per-registrant checks flushed at mount or the next grammar read — never mid-registration-batch, so intra-batch forward references stay warn-free — and an opener registered after documents have parsed dev-warns naming the kind (late registration stays legal: the 1.2 `plugins`-prop staggered mount is a real flow). Opener dispatch order is now a pure function of declarations (`priority`, then kind) so module-load order can never matter; equal priorities still warn as name-arbitrary.
- **Coherence derives from live registries.** A plugin keymap's command ids validate against minted `PluginCommandId`s (the built-ins-only gap is closed), and `reservedChrome` declarations get bootstrap coherence (G1.18): the declarer must be a container and its chrome kind must resolve to a registered descriptor and component.
- **Grouped container registration.** Container-only descriptor fields register as one `container` unit (`BlockKindRegistration`); `rebuildRaw` is required inside the group, so the container/rebuild pairing violation is structurally unrepresentable — G1.3 retired upward (guarded → unrepresentable) and its predicate deleted. Both write seams also strip container-only keys from widened flat objects, closing the structural-typing escape the type pins can't see. Built-ins and both dogfood plugins migrated.
- **`ContainerBlockListProps` inverted.** The container-seam props type is now an authored contract with a two-direction compile-time conformance check; an internal BlockList prop edit fails `npm run check` at the contract instead of silently rewriting the public shape.

### 0.9.7 — Command mint: plugin block-commands + registry fail-loud

Roadmap item 1. A plugin mints a command id, binds it to a kind's keymap, and the container-bubble dispatch runs it — the first increment of a unified command registry — plus the two P0 registry fail-loud fixes the freeze needs.

- **Plugin command mint.** `registerBlockCommand(kind, name, handler)` on `aragonite/plugin` mints a branded `PluginCommandId` and registers a `(kind,id)` handler; `AnyCommandId` threads plugin ids through the keymap/override/dispatch types (mirroring `AnyBlockKind`). The `:::note` callout gains a `callout.setKind` command bound to `Mod+7`/`Mod+8`, validating mint → keymap → bubble dispatch → handler → metadata commit → the existing `metadataUpdate` op end-to-end — no new op kind. `BlockCommandContext` and the handler shape join the pre-freeze plugin surface; plugin-op vocabulary stays deferred (metadata edits already emit `metadataUpdate`).
- **Bubble dispatch single-sourced.** `dispatchKindCommand` is the one seam every container-bubble keydown routes through — resolving the registry, else the container's `runCommand`; the built-in list/blockquote/table containers migrated onto it, deleting the per-container duplication. The container factory supplies the command context (routing `updateMetadata` to `updateOwnMetadata`). The leaf path widens types and dev-warns a dead plugin-command key; its registry tier is deferred to a driver (built-in-command migration + the command palette are the unified-home follow-up).
- **Two P0 registry fail-loud fixes.** `registerInlineWidgetKind` throws on duplicate — a plugin can no longer clobber the built-in `image`/`rawHtml` widgets process-globally; `augmentBlockKind` rejects built-in kinds via a structural `augmentBuiltin` seam kept off the public surface, closing the silent built-in-descriptor-rewrite path. Miss-analysis: the sibling entry-layer registries lacked the register-once / augment-guard tests their peers already had.

### 0.9.6 — Review hardening: corruption fixes, path-dialect unification, contract quick-wins

A full four-pass audit (every Critical/Important finding independently verified) followed by
reviewed fix waves. Three byte-corruption classes closed, one deadline-bound restructure landed
before the 1.0 freeze, and the plugin surface met the corruption oracle for the first time.

- **Selection × tables no longer corrupts the CST.** Table-endpoint normalization moved inside
  the selection state (`enterCrossBlock`/`extendFocus` — the sixth entry path can no longer
  miss it), closing two hand-reachable corruption gestures (double Ctrl+A with a table at a
  document edge; shift-click between paragraph and cell). Shift+ArrowUp from a container's
  first leaf no longer extends downward; cross-block delete holds a re-entry latch; table
  endpoints join the multi-scope commit so whole-row snaps keep row ids stable (the standing
  table-kind audit exclusion is gone).
- **Inline parser stopgaps** (the full CommonMark delimiter/bracket-stack rework is
  roadmapped): a link destination can no longer terminate inside a code span (typable
  byte-corruption via `textContent ≠ raw`); the emphasis multiple-of-3 gate reads original run
  lengths (divergence vs commonmark.js: 865/72,702 → 0); bracket nesting is depth-capped;
  entity and paren scans are bounded; a GFM header/delimiter count mismatch now rejects the
  table per spec instead of silently truncating header cells.
- **One path dialect on the public event channel.** Commit scopes mint doc-absolute event and
  undo-snapshot paths at the seam (factories, not call sites) — nested ops no longer emit
  scope-local paths, no-caret undo restores land for click-driven container ops, typing in a
  container-nested link-reference definition rebuilds the resolver map, and a dev guard
  (G1.16) makes the next dialect drift loud. Landed pre-freeze on purpose: the `edit` channel
  is what external consumers bind to at 1.0.
- **Plugin contract quick-wins (pre-freeze, user-approved).** `parse`, `serializeChildren`,
  `trimTrailingLineEnding`, `declaredPluginKind` (kills the cast ceremony), typed
  `BlockComponentProps`/`ContainerBlockComponent`, and registry probes for kind/component/
  opener on `aragonite/plugin`; collapse-ness single-sourced from the declared probe (window
  clamp and height oracle derive from it — a collapsed container estimates one chrome row);
  dev guards for misbehaving openers (G1.15) plus a misuse-outcome table in the contract doc;
  `KeyBinding.arg` widened for the coming command mint; the uncallable `registerCommand`
  export removed until the mint lands.
- **Interaction/a11y fixes.** Focus and reveal skip failed-render blocks instead of hanging;
  the stale top-level reveal ref is fixed with a deterministic guard; keyboard reorder works
  for code blocks and thematic breaks; table alignment restores focus and announces; Ctrl+F
  works with CapsLock; structural paste lands the caret at the end of pasted content; pasted
  unordered items adopt the destination list's bullet on every paste route; case-insensitive
  search is fold-safe (İ) and a new query starts at the first match.
- **Theming made real; tooling unblocked.** The eleven documented `--syntax-*` tokens are now
  actually read (visually neutral by construction — consumer overrides work without changing
  the shipped look); undeclared token reads fixed; the css-ownership lint catches off-family
  tokens; the perf gate finally has launchers (`perf:check`/`perf:editor`/`perf:e2e`);
  plugins/simulation area scripts; CI caches browsers; the consumer-smoke pack pin self-heals
  across version bumps.
- **Structure + test infrastructure.** `editor-actions/` reorganized (`commit/`, `focus/`,
  `plugin/`; the layer's one upward value edge removed at the barrel seam); an invariant-
  watcher Playwright fixture (invariant fires now fail adopted specs); the two largest spec
  files split 4-way each; a plugin-ops simulation profile — the strongest corruption oracle's
  first contact with the plugin surface, green; nine requirement files backfilled; an
  adversarial parser pin corpus with widened property generators (non-ASCII,
  cross-construct).

### 0.9.5 — Details/collapsible: the second chrome consumer + first-class collapse

The `details`/collapsible dev-harness plugin validated the reserved-chrome contract as its second real consumer — zero internal reach-ins for the component, SSR + hydration clean with interactive chrome — and collapse landed as first-class machinery.

- **The `<details>` kind** — a narrow canonical form claimed ahead of the htmlBlock opener (non-canonical HTML declines back to it), the summary as a chrome child, and `open` metadata round-tripping `<details>` ↔ `<details open>` byte-for-byte.
- **Collapse is a windowing clamp** — a collapsed container renders only its chrome row through the existing windowing machinery: the body genuinely unmounts (O(viewport) preserved), and reveal into a collapsed body degrades to the summary _without editing the document_.
- **A declared collapse probe** — `reservedChrome.isCollapsed` on the container descriptor makes every child-adjacency operation collapse-aware as a class: merge-from-below stops at the chrome instead of writing into the hidden body, arrows exit the summary, and Enter cannot mint invisible paragraphs.
- **Chrome × table composition closed** — cross-block ranges involving tables inside a chrome container's body now honor the chrome wall (clear, never delete); a latent identity bug in the table branch's nested-endpoint path was fixed in the same pass.
- **Clipboard** — a cross-block copy ending mid-title/summary now emits reparseable container bytes via the kind's own raw rebuild over a synthetic chrome node (the start-in-chrome direction is recorded for the post-1.0 clipboard generalization).
- **Promotion finding** — both consumers independently need the same three core helpers (`parse`, child serialization, line-ending trim); they are promotion candidates for the plugin surface when the tarball gate forces the decision.

### 0.9.4 — Plugin authoring: containers, editable chrome, the reserved-chrome contract

The first real plugin-authoring surfaces, exposed **pre-freeze** on the `aragonite/plugin` subpath and dogfooded by a `:::note` callout dev-harness plugin (`/test/plugins`). Design records: `docs/design/plugin-contract.md` (pre-freeze surface + boundary), `docs/issues.md` § Plugin containers (known deferrals).

- **Container authoring** — `createContainerBlock` wires a nested-`BlockList` plugin container (list state, ancestor contexts, nested actions, windowing, the `BlockComponent` surface) in one factory, so a plugin container is as thin as the built-in blockquote. Plus typed plugin metadata accessors and idempotent-registration probes.
- **Editable chrome** — `registerChromeLeaf` registers a container's editable title/summary leaf in one call, with a default keymap (Enter descends to the body; chord-keyed caller overrides). `contextDependentKind` makes recognizer-less kinds keep their kind through content edits (generalizing the hardcoded tableCell skip); `containerContract: 'opaque'` names containers whose raw is authoritative rather than a strip decomposition.
- **The reserved-chrome contract** — a container declares its chrome slot (`reservedChrome` on its descriptor) and the machinery enforces it: **always present** (backfill re-mints the chrome kind), **single-line** (unsplittable; the built-in `chrome.descendToBody` Enter; paste flattens inline ahead of the container-paste family), **cleared, never node-deleted** by cross-block ranges (a chrome wall in range deletion — nothing merges raw across the container boundary), and **kind-stable**. Validated by a selection spike first: chrome modeled as a real child node inherits cross-block selection, caret, and undo natively, with zero selection-layer changes.
- **Guards** — new dev invariants for opaque-container staleness, rebuild determinism, and the chrome slot; the plugins e2e project now fails on any dev-invariant fire. One known composition gap (table endpoints bypass the chrome wall) is logged and owned by the `details` cycle.

### 0.9.3 — Library packaging + external consumer harness

The editor became an installable package, proven from outside the repo.

- **Packaging** — `svelte-package` build with an `exports` map covering the component barrel, the `aragonite/plugin` subpath, and the theme CSS; `svelte` as a peer dependency; the dist pruned of test files; a verified `npm pack` artifact.
- **External consumer harness** — a durable `examples/consumer` SvelteKit app installs the packed tarball (not `$lib`) and imports only public entry points; the editor server-renders and hydrates cleanly.
- **CI `consumer-smoke`** — packs, installs, type-checks, SSR-builds, and smoke-tests the consumer on every PR, making the public API's from-outside usability a standing gate.

### 0.9.2 — Table mouse affordances

Pointer and contextual-menu editing for tables, pairing with the keyboard chords so table editing is no longer keyboard-only.

- **Hover grips + drag reorder** — hovering a row or column reveals a grip; dragging it reorders that row or column (a single insertion line, autoscroll to reach off-window rows and wide-table columns, one commit on release), and clicking it opens a row/column action menu.
- **Contextual menu** — the grip menu and a right-click on any cell open the same menu: insert/delete row and column, L/C/R column alignment, and cut/copy/paste for a cell. It also opens from the keyboard via Shift+F10 / the Context Menu key.
- **Keyboard column reorder** — Alt+←/→ moves the focused column one slot, mirroring the Alt+↑/↓ row reorder.
- **Menu nav + announcements** — full arrow / Home / End / Esc keyboard navigation of the menu, with screen-reader announcements. Two caveats noted in the consumer guide: menu Cut/Copy write rendered cell text (vs. the keyboard raw-source slice), and menu Paste depends on `navigator.clipboard.readText()`.

### 0.9.1 — Pre-1.0 polish: theming for extraction, consumer docs, hygiene

Module-readiness polish ahead of the standalone-repo extraction.

- **Theming scoped for extraction (single-flow).** All tokens moved off `:root` to the editor's own scope (`.editor`, plus an opt-in `.aragonite-editor-theme` class for non-editor chrome), so the module no longer injects custom properties into a consumer's global scope and a consumer themes the editor through one channel — overriding tokens at the editor scope. Light/dark keys on a `data-editor-theme` attribute driven by a new `theme` prop (`'dark'` / `'light'` / custom name), replacing the global `:root[data-theme-type]` toggle. The `--color-*` chrome tokens gained light+dark defaults too, so the editor (search bar, image, code backgrounds) renders correctly in both modes host-less. The limestone consumers drive the prop from the active app theme via a new `currentThemeType` store, so the in-app editor follows app light/dark.
- **Consumer guide completed.** The `getSearch()` controller and `searchBar` prop, the named CST utilities (`parseInline` / `getContentRange` / `isProseKind`), the `EditEvent` / `EditorError` payload envelopes, a minimal mount example, and the theming scope/toggle/override contract.
- **Hygiene.** Dimmed-marker opacity tokenized (`--syntax-marker-dim`); code/mono surfaces unified on `--font-editor`; the `/test/editor` route gained a landing affordance and lifted its `window.__test` probe surface into a module. List indent/promote now adopt the destination bullet glyph within the unordered axis.

Internal only.

### 0.9.0 — Remaining GFM + public API

Closed the last CommonMark autolink gap and made the editor's public API truthful, per-instance, and overridable.

- **Angle-bracket absolute-URI autolinks.** `<scheme:…>` for any valid scheme (`<ftp://…>`, `<mailto:…>`, custom) now autolinks — the former `http(s)`-only recognition generalized to the CommonMark absolute-URI grammar, closing the one §6.8 gap.
- **Keybinding-override prop.** A per-instance `keybindings` prop rebinds, adds, or disables bindings over the built-in command vocabulary without forking, consulted ahead of the built-in keymaps at every dispatch site. The override map flows through context (no module-global mutation), so two editors can carry different bindings; the full `CommandId` vocabulary and the chord format are exported as public types. Undo/redo chords are overridable too — the input-layer history interception (which suppresses native browser undo) now routes through the override-aware dispatch with precise chord matching, fixing a loose key check that also mis-caught Ctrl+Alt+Y as redo.
- **Public-API truthfulness.** The production consumer and the demo import `Editor` from the `$lib/editor` barrel (proving extraction is mechanical); `EditorSelection` and a named `EditorInstance` handle are exported; `EditorProps` is single-sourced so the component consumes its own published type and can't drift, guarded by a compile-time conformance check.

### 0.8.10 — Perf attribution + flat-shape gate

Closed out the 0.8 performance line. Measurement overturned the working model: the apparent flat high-block-count keystroke residual was a harness artifact, not editor cost.

- **Flat keystroke is O(viewport).** The latency harness settled each keystroke by summing `docLengthInPage` over the whole `$state`-proxy children array (O(children) per poll), inflating flat high-block-count rows — many-small-blocks-10MB read 231ms where the editor cost is ~3ms. Attribution (`axisS`: mounted/renders/CDP-ScriptDuration flat across 1k–30k blocks) confirmed windowing fully bounds the keystroke; fixed the settle to read the edited block's own length term.
- **Flat shapes now gated at 10MB.** With the artifact gone, `perf:check` enforces every renderable shape's 10MB keystroke (flat 10MB rows were previously excluded for the now-removed artifact). Baseline re-blessed.
- **Sticky-nav scan bounded.** `findOffsetNearestX` scanned every offset in the block; it now scans only the probed visual line's neighborhood (O(lines-near-edge), not O(raw length)), so sticky Up/Down through a giant paragraph no longer measures a rect per character.
- **Two limitations accept-documented** (`docs/design/performance.md`): the intra-block single-giant-paragraph keystroke (Axis 5 — O(paragraph-length) span rebuild, ~177ms prod @ 1MB; synthetic and transient — Enter splits the paragraph), and flat load (O(node-count) reactive-tree materialization, sub-second at realistic sizes, ~22s only at the 392k-block 10MB extreme).

Internal only.

### 0.8.9 — Editor quality pass

A batch of editor polish across reorder, find/replace, and link safety.

- **Keyboard table-row reorder** — Alt+↑/↓ inside a cell moves the focused body row one slot among the body rows (building on 0.8.7 block reorder): one identity-preserving structural reorder, a single undo entry, focus following the row in its column, and a live-region announcement. The header row is positionally fixed; a boundary press is a no-op. Keyboard-only; the drag affordance is roadmapped.
- **Find/replace polish** — undo after replacing nested content restores the caret to the exact nested leaf (list item / table cell), not the top-level block; a zero-width regex match (`a*`, `^`) no longer paints an invisible highlight sliver.
- **Default link activation hardening** — the editor's default link handler is now policy-gated through the scheme allowlist (`isAllowedHrefScheme`), so a host that supplies no `onLinkActivate` won't open a `javascript:` / control-byte URL by default.

Internal only.

### 0.8.8 — In-document find/replace

Find and replace within a document: a toggleable top-right floating bar plus a public engine API. Search is a read-only lens over the CST — scanning and highlighting never mutate the tree, parser, or inline cache.

- **Engine** — a pure `search/` module scans editable leaves for matches (case / whole-word / regex toggles; regex with `$1` capture refs and an invalid-pattern error state), keyed by block path. Container raw and ambient prefixes are never scanned.
- **Highlighting** — a per-block `MatchOverlay` (sibling to the selection overlay) paints matches through the existing `measurePartialRects` hook, so windowing bounds highlight cost to the viewport. Table cells, which render outside the block-host path, paint as whole-cell highlights via a selection-independent `cellRect`.
- **Replace** — per affected top-level subtree, the substituted source is reparsed and committed as one identity-preserving `replace`, batched into a single undo entry; cost is O(affected), not O(document), and untouched top-level blocks keep their identity. Table-cell replacements escape `|` and newline so a row can't be split. Replace and Replace All; regex replacements expand `$1`/`$&` and `\n`/`\t` escapes.
- **Bar + API** — `searchBar` prop (default on) renders the built-in bar (Ctrl+F find, Ctrl+H replace, Esc closes and restores focus); `editor.getSearch()` exposes the controller so a consumer can disable the bar and drive a custom UI. Re-scan runs only while the bar is open, deferred off the keystroke path (zero added keystroke cost). Known limitation (`docs/issues.md`): off-window rows of a windowing-active giant table don't re-measure highlights — shared with the selection overlay.

Internal only.

### 0.8.7 — Block reordering

Move a block among its siblings — top-level blocks, list items within their list, and a blockquote's children — over one structural reorder operation reachable two ways.

- **Keyboard** — Alt+↑/↓ nudges the focused block past a sibling, with a screen-reader live-region announcement of the new position. Always available.
- **Mouse drag** — a hover handle (revealed on the innermost reorder host only) drags the block; a ghost follows the pointer and a single insertion line marks the drop gap, with no mid-drag reflow and one commit on release. Escape or pointer-cancel aborts cleanly. The handle is consumer-toggleable via `blockDragHandles` (default on).
- **Off-window targets via autoscroll** — drop hit-tests against mounted siblings, so a target below the fold is reached by holding the pointer near the viewport edge to autoscroll it into the window, not by spacer-region hit-testing. There is no precise off-window drop; this is the intended reach for large, windowed documents.

### 0.8.5 — Lazy `inlineContent`

The inline tree — a derived Phase-2 rendering cache — moves from eager to cost-on-read, consistent with container-raw (0.7.4) and virtual rendering (0.8.6): inline cost becomes O(viewport-rendered + on-demand-touched), not O(document).

- **Cost-on-read accessor** — non-render consumers read inline content through an accessor backed by a node-keyed, non-reactive WeakMap, validated on read by `raw` plus the link-reference signature (no dirty flag; a shared/unchanged node hits, a copy-on-write or in-place `raw` change misses and recomputes). The render path computes locally and caches nothing.
- **Eager work deleted** — the whole-document inline sweep at load and per commit is gone, along with its `inline-dirty-set` scoping; undo/redo and link-reference edits no longer re-parse the document inline, and the common keystroke no longer double-parses the edited block.
- **LRD-map rebuild gated** off the keystroke hot path — the link-reference map rebuilds only when a commit could change the reference set, not on an ordinary paragraph keystroke.
- **`inlineContent` removed from `CstNode`** — accessor-only, which narrows the 0.8.3 plugin freeze before any plugin binds (see `docs/design/plugin-contract.md`). The retired render-path corruption guard (G4.2) downgrades to a perf-hygiene lint — with no reactive cache field, the read/write cycle it guarded cannot recur.
- **Scale gate un-capped** — the giant-single-list/blockquote/table fixtures, capped at 1MB on a stale (never-measured) assumption their 10MB load wouldn't complete, are now measured and gated at 10MB: load is linear and windowing bounds the mount, so the keystroke is O(viewport). reference-heavy un-caps too (lazy inline removed its keystroke's whole-document sweep).
- **0.8.1 incremental parsing dropped** after measurement — parse is a small linear fraction of load and structural edits already re-parse per block, so block-level incremental parse addressed no measured cost. Its one residual is the long-single-paragraph intra-block axis (Axis 5), tracked separately.

### 0.8.3 — Plugin-API contract freeze (foundation)

Freezes the foundational plugin-facing contract — the shapes external plugin code binds to at 1.2 — while changing it is still cheap, before any binding. Not exposed from `index.ts` yet; 1.2 flips the switch. Design record (with the breaking-if-deferred vs additive-later decision table that justifies the scope): `docs/design/plugin-contract.md`.

- **Node identity** — `CstNode.kind` widens from `BlockKind` to `AnyBlockKind` (built-in union + branded plugin kinds), so a plugin-kind node is a first-class CST citizen through render, measure, and serialize. A structural `isBlockNode` guard (`'raw' in node`) replaces kind-based `CstNode | Document` narrowing, which the widening made unsound (a plugin could name a kind `document`).
- **Registries are code, not state** — the five kind-keyed registries (block-kind descriptors, components, openers, commands, paste surfaces) are register-once: a duplicate registration throws (the `customElements` model), making real what `consumer-guide.md` already promised. `augmentBlockKind` stays the deliberate-merge path; no runtime unregister/replace (a Plugin System II concern). A unified test reset clears non-built-ins; registration modules are dev-HMR boundaries (a register-once edit needs a reload).
- **Plugin-kind naming** — `declarePluginKind` rejects collisions with built-in kinds, the reserved structural sentinel `document`, and previously-declared plugin kinds.
- **Events access** — `getEvents()` ratified as the canonical accessor; stale `editor.events` references corrected across the docs.
- **Scoped out, in writing** — manifest / `plugins` prop / lifecycle (target shapes, built at 1.2); the `EditEvent` snapshot/real-delta discriminant (additive, designed with its post-v1 version-history consumer — the naive `snapshot`-derived flag would mislabel ordinary typing); the 0.8.2 inline-parser hook.

Internal only.

### 0.8.2 — Inline-widget registry (consolidation)

The decision "is this inline node a live atomic widget, and how is its widget-ness recognized" is single-sourced into one `core/inline/` registry, replacing logic previously spread across a model predicate, the renderer's raw-HTML branch, the `<br>` tag allowlist, and an unenforced doc comment.

- **Recognition is registry-owned** — one predicate answers widget-ness for every consumer (vertical-skip, edge-select, cursor adjacency, clipboard, the renderer); a new widget inline kind registers rather than editing scattered branches.
- **Builders dispatch by layer** — the core `<br>` builder is registered; the image builder stays injected per-render (it carries the per-instance broken-URL cache) and is never process-global. The per-block `renderImagesAsWidgets` policy stays on the block-kind descriptor — a separate axis from kind-level widget recognition.
- Behaviour-preserving (identical widget set), internal only. This is the consolidation half of 0.8.2; the parser-stage extension hook stays open (see roadmap) — widget-ness is a render+model decision, not a parse one, so that hook awaits a real inline-syntax consumer.

### Forge-review hardening (post-0.8.6)

A four-pass review of the editor module with tiered fixes. Substantive seams:

- **Cross-block table selection** — a whole-row snap at the selection-normalize chokepoint makes highlight, copy, and cross-block delete agree on a mid-row table endpoint, closing a Cut data-loss; pointer-drag endpoints carry cell coordinates like the keyboard path.
- **Commit rollback** — a throwing container/multi-scope commit now restores each scope's pre-mutation children, so the live tree is never left partially mutated.
- **Editor-root keystroke routing** — when the caret's block is windowed out and native focus drops to the document body, a document-level listener routes cross-block and undo/redo keystrokes (focus parks on the editor root on unmount), closing undo/redo-inert-when-unmounted.
- **Editable-surface factory** — the contenteditable plumbing shared by the three editable blocks is extracted into one `createEditableSurface` factory behind a cursor-backend seam.
- **Forward-delete + list markers** — nested code-block forward-delete uses a focus-layer move-or-noop instead of a root-vs-container index mismatch; ordered markers adopt the destination punctuation on indent/promote.
- **Per-instance state** — the image broken-URL cache is per editor instance; the "global schema, per-instance state" contract is documented for consumers.
- **Test coverage + structure** — the simulation oracle now exercises tables and runs fenced-code/image round-trip checks in CI; the undo ceremony is grouped under `editor-actions/undo/` and block components are colocated per kind.

Residual: viewport-follow on an off-window cross-block extend for deep-nested lists (tracked in `docs/issues.md`). Internal only.

### 0.8.6 — Virtual rendering (windowing)

Mounted block components bounded to the viewport at every nesting depth, turning steady-state keystroke cost from O(mounted) to O(viewport). Design record: `docs/design/virtual-rendering.md`. Seams:

- **Top-level windowing** — `BlockList` self-activates (hysteresis watermarks), rendering a sliced window between top/bottom spacers so native scrollbar geometry stays real. A per-kind height oracle (O(1) `raw` estimate, replaced by measured height cached by stable id) feeds a Fenwick index↔offset model; a `revealPath` primitive scrolls off-window focus/caret/undo/selection targets into the window and awaits their mount before acting, with the focused block pinned mounted. Nested-containers 1MB keystroke p50 collapsed to flat-prose parity as mounted components dropped to viewport scale; a machine-independent mounted-count ceiling joins the commit gate.
- **Recursive container windowing** — extends into blockquote, list-item, and long-flat-list scopes (a `list` / `table` bypasses `BlockList` and windows its own `{#each}` children directly). One shared `createListWindowing` per scope composes the oracle + model + window; the absolute-index slice contract is single-sourced in `sliceWindow`. Measured heights propagate upward through two passive index-keyed channels (leaf and subtotal); `revealByPath` descends nested levels.
- **Table-row windowing** — a giant table windows its rows, reusing the shared wiring wholesale; the one new mechanic is grid geometry (row height read from a cell, spacers span the full grid width). Row→cell path descent also closes the cross-block-command-can't-reach-a-table-cell gap, and the pass fixed a chain of pre-existing table cross-block selection bugs (cross-block edit wiping a table body, collapse-to-start cell landing, last-block delete leaving one empty paragraph).
- **`useContainerWindowing` extraction** — the per-scope wiring boilerplate collapses into one hook so a future or plugin container kind inherits windowing by naming only its variation.
- **Pressure-test hardening** — width/resize invalidation, manual scroll-anchor correction (`overflow-anchor` disabled), the scope-owned batched read-all-then-write measure pass, bounded reveal, off-window pure-data vertical-transparency, per-scope width estimates, and sticky-column geometry from the first mounted row — backed by non-vacuous regression guards (layouts-per-mount bound, settled-scroll-position compensation).

Known limitations at the time: single-giant-container shapes windowed rendering but their 10MB _load_ stayed capped at 1MB in the harness (since un-capped in 0.8.5 — load is linear and the keystroke is O(viewport)). (The block-scoped-keydown focus drop and the column-width drift listed here were fixed in the later forge-review hardening pass.) Internal only.

### 0.8.0 — Latency attribution + first-edit re-render fix

Opens the 0.8 performance line. The profiling harness gains block-render and in-page keystroke instruments plus a prod-vs-dev capture project; the attribution (record: `docs/design/performance.md`) traces the nested-1MB keystroke cost (~375ms prod) to two sources — a dominant steady-state framework reactive-flush proportional to mounted components (ratifying virtual rendering (0.8.6) as the primary spine) and a one-time first-edit full-document re-render, fixed here: the `$state` link-reference resolver was reassigned a fresh identity on every edit, re-rendering every block that read it at mount; it now reassigns only on LRD-signature change, and the render path reads it only for bracket-bearing blocks. Guarded by `block-render-scoping.spec.ts`. Internal only.

### 0.7.12 — Module-readiness completion

Closes the Track B module-readiness line. `index.ts` is curated to exactly what an `<Editor>` consumer needs (the component + its props/resolve/policy types, `parse`/`serialize` and inline preprocessing, node/inline and event-payload types); internal plumbing leaks are pulled back (`LIST_CONTEXT_KEY`, the tree-op primitives, `createUndoManager`/`cloneDocument`/`assignIds`, `editor-keys.ts`) on the asymmetry that adding an export later is non-breaking but removing one is breaking. The four test/debug methods move behind `editor.__test`. Two consumer docs land: a module `README` and `docs/guide/consumer-guide.md`. `dev-warn.ts` decouples from the build toolchain via an injectable `env.ts` seam (`configureEditorEnv`). Per-file unit coverage closes the transitive-coverage gap for `cursor/sticky-measure.ts`, `cursor/visual-lines.ts`, and `devWarn`. No behavior change. Internal only.

### 0.7.11 — CSS ownership migration

The editor module owns its CSS. Two stylesheets ship under `src/lib/styles/`: `editor.css` (structural painting rules for imperatively-built DOM, auto-imported) and `editor-theme.css` (editor-owned token values, consumer-imported). Every painting rule is wrapped in `:where(.editor)` — full namespacing at zero added specificity. Editor-owned tokens (`--syntax-*`, `--code-tok-*`, `--font-editor`, promoted presentational tokens) are declared at `:root`; host tokens (`--color-*`, `--radius-*`) are only read-with-fallback so the host's `applyTheme()` keeps winning. Divergent fallbacks collapsed to one canonical value per host token; engineered zero-visible-change and verified pixel-identical in both palettes. New G4.6 source-scan guard keeps `app.css` clean. Internal only.

### 0.7.10 — Editor boundary-hardening

Three waves of boundary work, pre-staging the 0.8.3 freeze's error-reporting contract. Internal only.

- **Error boundary + commit rollback** — a new `error` channel on the editor's event surface (`EditorError`, `origin: subscriber | render | commit`); each block wrapped in a `<svelte:boundary>` so a render-throw degrades to a recoverable failed-block fallback with siblings intact; the commit ceremony captures both undo stacks before the push and restores them via `UndoManager.restoreStacks` on a throwing mutation (never publishing a partial tree).
- **URL / link policy + seam** — a pure scheme allowlist (`core/url-policy.ts`) enforced at the render sinks blocks `javascript:`/`vbscript:`/`file:` (and `data:` in `href`), defeating control-char obfuscation; a blocked scheme renders an inert `span.md-link-blocked`. Three consumer seams land with today's behavior as default: `resolveLinkUrl`, `imageLoadPolicy`, and `onLinkActivate` (replacing the hardcoded `window.open`).
- **Accessibility baseline + axe gate** — WCAG 2.1 AA declared as target; the editor root gains `role="group"` + `aria-label`; the AT-invisible cross-block selection is announced through a visually-hidden `aria-live` region fed by a pure `createSelectionDescription` builder. A new `e2e-a11y` project runs `@axe-core/playwright` over `.editor` and fails on any violation outside a committed, only-shrinking baseline allowlist (the milestone-tied log of deferred AA work).

### 0.7.9 — Command registry + per-kind keybinding declaration

Closes the Track B keybinding work. Per-block-kind keybindings become declarative — `BlockKindDescriptor.keymap` maps a normalized chord (`Mod` = Ctrl/Cmd) to a command id — dispatched through a command registry that replaces the scattered `onKeyDown` branches. The registry is a `schema/` leaf: `schema/commands.ts` single-sources the vocabulary and registers global commands as free functions, exposing `dispatchKeyCommand` (per-kind keymap → global fallthrough, for a focused leaf) and `resolveKindBinding` (kind-only, for container bubble handlers); `schema/keybindings.ts` owns chord parse/normalize. Block-local bodies run on the focused component via `BlockComponent.runCommand(id, arg?)`, which reads the caret live so cross-block dispatch operates at the collapsed position. The cross-block delete-then-redispatch hack retires (a source-scan guard forbids `new KeyboardEvent` in runtime source); new bootstrap invariant G1.11 (keymap coherence). One deliberate tightening: normalized chords match modifiers exactly, so modifier-augmented variants the old loose guards incidentally caught now fall through to native. Behavior-preserving against the full e2e + simulation; a double-undo regression (container bubble re-firing undo because a leaf's async handler `preventDefault`s only after an `await`) was caught by the gate and fixed by the kind-only container resolution.

### 0.7.8 — Schema seam

Three waves making the block-kind schema the single dispatch authority, scoped to 0.7's module-readiness. Behavior-preserving.

- **Op-vocabulary substrate** — `OperationDetailMap` (`schema/operations.ts`) derives `OperationKind`, `OpDescriptor`, and `EditEvent` so kind/detail drift is a compile error (retiring the widening casts). Plugin kinds become nameable via a branded `PluginBlockKind` (`declarePluginKind`, rejects built-in collisions); `CstNode.kind` deliberately stays `BlockKind` until the 0.8.3 freeze.
- **Declarative per-kind entry** — the parser's opener chain is registry-driven (kinds declare `{priority, tryOpen, interruptsParagraph}` in `schema/block-openers.ts`), and the paragraph-interrupt scan derives from the same declarations (new G1.10 guard). Container paste-merge is declarative (`BlockKindDescriptor.containerPaste`); the tableCell structural-paste special case moves to an `onScopedStructuralPaste` hook. Accepted, measured cost: registry dispatch adds ~8–16% to full-document parse on block-dense shapes (load-path only; keystroke re-parse unaffected).
- **UnwrapRole + declared rebuilders** — containers declare Backspace-unwrap behavior (`unwrapRole` names a first-child and middle-child strategy); `rebuildRaw` is declared at registration (bodies in `schema/container-rebuilders.ts`), retiring the post-augment patch-in. The G4.3 conformance kit holds container kinds to all three declaration families.

### 0.7.7 — Performance harness + inline-sweep scoping

The scale gate becomes measurable. A deterministic fixture corpus (six seeded shapes at any byte target, golden-pinned) feeds three layers: dev-mode perf instruments at five seams with a `__test.perf` bridge; a vitest bench suite (`perf:editor`) over parse, clone, and ancestry rebuild with a machine-stamped baseline; and a PERF-gated Playwright project (`perf:e2e`) recording fixture load and per-keystroke p50/p95. Machine-independent counter ceilings join the commit gate (`test:editor:perf`). Riding the harness: ten dead resolver-less `parseAllInlineContent` calls deleted, and the per-edit inline sweep scoped to a dirty-set (one top-level subtree on the typing path; whole-doc only on LRD-signature change or structural ops). Honest attribution recorded in the baselines — the sweep was not the dominant per-keystroke cost. A real bug surfaced: a typing batch displaced within the debounce window dropped its `input` event, leaving the previous block's inline cache resolver-less; displaced batches now flush on key change. `parseBlocks(lines, start, end)` is named a stable seam for range re-parse.

### 0.7.6 — Block-edit ladder + decomposition (Track A close)

Three waves closing Track A's architectural-hardening line. Behavior-preserving (full e2e + simulation unchanged).

- **Decomposition wave 1** — the keystroke debounce/batch state machine extracted into a named text-batch lifecycle (`editor-actions/text-batch.ts`); one owned `ContainerScope` shape across container/multi-scope/paste commits; `commitMultiScope` restructured onto `prepareScopeView`/`publishScopeView`; the `skipSnapshot` boolean replaced by an `undoEntry: 'own' | 'join'` option. Pure cores extracted with direct unit tests (`cellKeydownPlan`, `core/inline/ranges.ts`, `consumeStickyLanding`, `replacePreservingFirst`, and others), plus image-overlay orchestration out of `Editor.svelte` into `ImageOverlayHost`.
- **Decomposition wave 2** — by-convention couplings single-sourced, plus two logged defects closed (the IME-composition cross-block delete converged onto the commit primitive; `cascadeCleanupEmptyAncestors` no longer drifts a surviving ancestor's `childIds`). New seams: `pushChild`/`spliceChildren` lockstep helpers (`tree-operations/children.ts`), `updateNodeContent` speaking the `StructuralChange` return language, table column mutators returning per-row `StructuralChange`s, and the terminate-and-splice list-item weld.
- **Block-edit ladder core** — the top-level and container `BlockEditActions` factories stop duplicating their structural-edit bodies: a `CommitScope` adapter captures every per-level difference and `createBlockEditCore` writes split / merge / delete / replaceBlock / metadata once against it; the paste preDelete-fold single-sources into `foldPasteReplacement`. `insertParsedBlocks` and `updateBlockContent` stay per-factory by necessity (the dual-emit paste event, and the divergent load-bearing kind-change undo-batching — unification attempted and reverted). Closes Track A.

### 0.7.5 — Property/fuzz-test the invariants

Generator-based (fast-check) coverage over the load-bearing invariants: round-trip/parser-totality over arbitrary and malformed input, EOF edge states, inline-conformance corpus, the `textContent === ambientPrefix + raw` spine, inline-offset partition, serialization purity, selection partition, split/merge id↔ref↔children alignment, and the paste op-kind dual-emit. Reactivity and timing rules become source-scan guards; a registry-derived conformance kit holds any container kind to the per-container invariants. New `test:editor:invariants` area under `test/invariants/`.

### 0.7.4 — Structural-sharing undo

Undo checkpoints stop deep-cloning the document. The container-raw decision (`docs/design/performance.md`) keeps materialized container raw and spends the work on the undo axis, where the cliffs were. Snapshots now share the live tree's nodes, marked by an editor-level sharing epoch (`ownerEpoch`, `undo/sharing.ts`); a push costs O(top-level children) — ~1000× down — and per-snapshot heap drops to KB-scale spine divergence. The cost moves to mutation discipline: copy-path-on-write everywhere (`tree-operations/unshare.ts`), with the commit primitives owning the protocol. Aliasing is guarded three ways: invariant G1.9 (no mutation writes serialized bytes through a snapshot-shared node) with negative fixtures; a DEV integrity oracle digesting and re-verifying each snapshot at every commit and restore; and a keystone fast-check property driving random op sequences through the real action factories. The multi-seed simulation joined the default battery after the oracle caught a real Svelte 5 proxy bug; the fix — write the copy into the `$state` tree, then re-read it through the tree before further use — is now the canonical-reference discipline in the unshare contract.

### 0.7.3 — Spec/doc accuracy

Design-doc reconciliation surfaced by the architecture review: documented the table/grid exemption from the container-internal invariant, `unrecognized` as a reserved kind, the container-strip inline coordinate spaces, the commit-ceremony-vs-event-seam distinction, and the state-registry WeakMap-GC reality; unified (or justified) the scroll-ancestors divergence. Added the `docs/design/invariants.md` catalog.

### 0.7.2 — Node-model & schema guardrails

Convention-enforced invariants become compile-time and runtime-checked. Compile-time: typed `metadataOf`/`BlockMetadataByKind` (retires ~68 metadata `as`-casts), `defineBlockComponent`, union-derived `BLOCK_KIND_TABLE`, a `containerContract: 'strip' | 'grid'` descriptor field, branded `CURSOR_END`/`SELECTION_END` sentinels, and a cell-coordinate discriminant on `SelectionPoint`. Runtime: a dev-only, non-crashing `assertInvariant` channel wiring DEV checks (G1.1–G1.8) at the commit primitive, bootstrap, `cloneNode`, and the nested-actions helper; BlockHost renders a visible raw block for a kind with no registered component. Drove the svelte-check baseline from 21 errors / 18 warnings to 0 / 11.

### 0.7.1 — selection→table DAG inversion + issue-log sweep

Closes the `selection/ → components/` dependency inversion: the table foreign-drag hit-test moves behind an optional `foreignDragHitTest` descriptor hook registered from the top-of-DAG wire-up, so `drag-pointer.ts` dispatches by `data-block-kind` through the descriptor registry. Bundles the editor issue-log sweep: reference blocks re-render when an LRD changes elsewhere (render memo keys on the LRD signature, gated to reference-bearing blocks); blockquote-into-blockquote paste no longer destroys the target paragraph; type/paste across two top-level tables no longer corrupts the grid raw (carets are char-addressable deep paths with identity-resolved survivor paths); table cells now render inline content through the same pipeline as prose via a `cell-render.ts` factory, with widget-aware cell offset reads and cursor I/O.

### 0.6 — Complete GFM Coverage

Every GFM construct parses, renders, and edits (shipped as 0.6.1–0.6.7.1; per-patch narratives in git log). Task list items gained click-to-toggle checkboxes on a new `AmbientPrefix` interactive-range contract, with a source-preserving `taskMarker` metadata field. CommonMark §6.1/§6.2 pre-passes added backslash escapes and HTML character references. Tables became per-cell editable containers (Tab/arrow/Enter navigation, rectangular selection, row/column ops, alignment cycle, three-stage Ctrl+A, pipe-aware paste) and moved per-container ids onto `node.childIds`. Images render as atomic inline widgets (`contenteditable="false"`, dimension hints, drag/Shift+Arrow resize, a `resolveImageUrl` hook). Autolinks closed the GFM §6.9 gaps. Reference-style links and images resolve in all three forms with document-level resolver reactivity. HTML blocks meet §4.6 per-type close conditions and the paragraph-interrupt rule; inline raw HTML (§6.10) parses with allowlisted tags as atomic widgets. The paste-into-list family converged on one rule — absorb on matching list type, break out on mismatch, newline-terminated splices, pre-splice marker computation — and Enter on an empty nested item outdents one level. An eight-pass decomposition sweep (0.6.1.x) cleaned the layer DAG and retired shelf-named directories before the feature work resumed.

### 0.5 — Forge-Review Hardening + Pre-Coverage Seams

The full forge-review audit became the v0.6 baseline, worked off in five tiers (per-patch narratives in git log). Structural spine: every structural mutation unified on the `__commit` primitive with the `editor.events` seam (`edit` + `selectionChange`), multi-scope commits for cross-container mutations, `StructuralChange` descriptors auto-syncing ids/refs, a metadata-only commit path, and the `BlockListState` registry closing children-mutation bypass sites. One paste dispatcher replaced five paste sites, pinned by a clipboard regression suite. The debug engine and `/test/editor` panel gave investigations a structured CST/selection/undo/ops view. The list marker moved inside the contenteditable as the ambient-prefix contract (unblocking task checkboxes), `SELECTION_END` and the sticky-column two-axis contract were pinned before tables, and module-DAG consolidations made `BlockKindDescriptor` the single dispatch authority. Correctness sweeps fixed cross-block typing event emission, id preservation through IME, ambient-aware measurement, multi-line link reference definitions, and CRLF hard-break matching.

### 0.4 — Cross-Block Selection & Clipboard

Cross-block selection, overlay rendering, keyboard/pointer extension, and clipboard operations spanning multiple blocks. Path-based addressing (`path: number[]`) replaces flat block indices throughout selection and undo layers; lazy `SelectionState` (null in single-block mode) with cross-container "start wins" semantics; `SelectionOverlay` mounted at `BlockHost`; Shift+Arrow / Ctrl+Shift+Home/End / double Ctrl+A keyboard extension; rAF-throttled pointer drag with autoscroll; cross-block Copy/Cut/Paste/Delete/Backspace/type-replace; undo restores cross-block selection state. Follow-up patches (0.4.1–0.4.3): the organizational pass, paste correctness + code-block Enter through the CST + list-exit content preservation, and the pre-v0.5 sweep.

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
