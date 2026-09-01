# Live Mode

`presentationMode="live"` is the fifth rung of the presentation ladder (each mode is one rung on the same ladder, from raw source up to fully rendered). It hides every Markdown marker standing over content, nothing reveals them (not even the caret walking in, which is what preview-inline does), and the document stays directly editable. Like every rung it is CSS over the one render path (`editor.md` § 4), so the bytes, the coordinate space, and the round-trip are the source document's throughout. The paint, then, is nothing new. The editing semantics are, and cataloguing them is what this document is for.

A `live-mode.md § 4.x` citation in source or tests resolves to § 4 below. Those rule numbers are stable addresses: they never renumber.

Where the same material lives elsewhere:

- `docs/guide/consumer-guide.md` § Presentation modes: the consumer-facing statement of these rules.
- `src/lib/e2e/requirements/presentation/`: the `presentation-live-*` files pin each behavior as e2e scenarios.
- `docs/contributing/codebase-map.md`: where each behavior lives in the code, indexed by behavior.

## 1. The problem

Hiding a marker is easy. Editing around one nobody can see is where it gets interesting.

A hidden marker run (the consecutive delimiter bytes of an inline construct, the `**` of bold say) paints at zero width. So wherever a construct's delimiters sit, one screen position names two raw offsets, and delimiter bytes can be typed against, cut through, or emptied while invisible. Every rule in § 4 answers one instance of that ambiguity. Each is applied at one seam (a boundary where responsibility passes from one piece of code to another), so it holds for every gesture that reaches the seam instead of being re-implemented per entry path.

## 2. The discipline: candidates, verified by the painter

No live rewrite trusts its own reading of the bytes. Not one. A rewrite produces a candidate byte string and verifies it through the render path's own `renderedText` (`core/inline/visibility.ts`, the one place that answers which spans a mode leaves on screen, shared with the caret walk, G4.30; a G-number is an entry in `docs/design/invariants.md`'s catalog). Call that check the painter. The rule it enforces: the screen after the write must show exactly what the gesture claimed, and live may drop only bytes the reader never saw.

The details:

- Each rewrite asks the painter with a stated reading. Either the block's own screen, where the answer decides what a press may touch, or the content behind every marker family (a marker family is one class of marker the renderer paints: emphasis delimiters, heading prefixes, fence lines, and so on), where the check is a before/after conservation diff (G4.33).
- The content reading is licensed only where the block's chrome hides, so every seam that takes it first declines a side whose chrome PAINTS. Over bytes the reader is looking at, that reading would call them unseen and hand the seam permission to drop them.
- A candidate that fails is not written; the byte-literal edit stands instead. Every seam therefore has a sound fallback, never a best guess, and the fallback may paint markers (a `plain` construct's split is the known case) rather than trade the round-trip for the effect.

## 3. Policy is data

How a construct behaves at its hidden edges is its declared row in the inline-construct policy table (`schema/inline-construct-policy.ts`). Seams read rows, never lists of kinds, so a new markable construct costs a row rather than a new case at every toggle surface. A row declares:

- `edgeAffinity`: which side a typed byte seats on (§ 4.2).
- `autoUnwrapOnEmpty`: whether emptying the construct unwraps it (§ 4.4).
- `splitBehavior`: how a split treats it (§ 4.4).
- `revealable`: whether preview-inline may reveal it.
- `cardEditable`: whether the link card (§ 4.6) is the way to its destination.
- `mark`: what a format chord writes for it: the delimiter run, the rank a set of marks nests in, the command that toggles it, and a wrap function where the delimiters depend on what they enclose.

The same table holds the two registered rewrite slots, the split rebalancer and the join-seam cleaner; each slot has exactly one reader, in `tree-operations/node-ops.ts`.

Two things deliberately stay outside the table, and a census (`test/invariants/lint/policy-arm-census.test.ts`, the lint that keeps the table and its readers in agreement) records both with their reasons rather than leaving them to drift:

- The caret-edge dispatch's branch list is a total order over gesture FAMILIES, which is a different question from a per-construct row.
- Whether a destructive key or a join takes a construct whole is a per-NODE fact, not a per-kind one: an empty link paints nothing though its kind normally encloses content, and an image's alt is content though the kind renders as an atomic island. The second table, the inline-widget registry, answers that island question. `image` legitimately sits in both, and the census asserts the boundary by naming every file that reads either.

## 4. The editing rules

Seven rules, each cited from source and tests by its number:

1. § 4.1: the two prohibitions every other rule applies, and what happens when a loaded document already violates them.
2. § 4.2: which side of an invisible delimiter a typed byte lands on.
3. § 4.3: what a formatting toggle does when there are no delimiters to show for it.
4. § 4.4: what happens to delimiters an Enter or a delete cuts through or empties.
5. § 4.5: the cleanup every destructive join runs where two pieces of text meet.
6. § 4.6: the link card, the only reader and writer of a destination live never paints.
7. § 4.7: the language chip, the way into a code fence's info string.

### 4.1 What live never writes

Two prohibitions, applied by every rule below:

- **No invisible residue.** A delimiter pair enclosing nothing paints as nothing, so live never writes one, and removes one wherever an edit would create it.
- **No unverified drop.** Bytes leave the document only when the painter confirms the reader never saw them (§ 2).

A document can already hold such residue when it loads: a typed `#` before its heading has a word, a fence before its first body line, a loaded `[](url)`. There the prohibition falls on the paint instead of the bytes: chrome (a block's marker furniture, the `# ` or the fence line, as opposed to its content) may hide only while it stands over content, so a construct with none shows its markers dimmed, exactly as source mode shows them.

The painted state governs three things and claims no more: where a caret can land, which side an inserted byte seats on, and what a destructive key beside an inline construct may take. A painted delimiter is a byte the reader saw, so § 2's drop license does not reach it and the press stays the engine's. A block's OWN structural gate reads the mode instead, so the rungs still diverge there: Backspace at raw offset 0 of a painted `# ` takes the whole construct in one undoable press, leaving an empty paragraph, where source mode at the same offset leaves the document unchanged.

The wiring, for the curious:

- Each block surface stamps the content-empty condition on its walk container (the contenteditable element the caret geometry reads) every render, and the two consumers of the hiding rule (the stylesheet and `cursor/widget-offset.ts`) read the stamp under the same modes and over the same marker families.
- The preview rungs take the same rule; reading mode does not, since it takes no keystrokes.
- Without the rule such a block would have no landable caret position at all, which G1.33 refuses at the focus entry every caret route crosses.

### 4.2 Typing at a hidden edge

A byte typed where a marker run sits is seated by the edge seat (`components/blocks/text/edge-seat.ts`), which reads the kind's policy first and the caret's arrival second:

- A `never-extend` kind (link, autolink, image, escape, hard break) seats the byte outside its delimiters, whichever side that lands on. Two halves of a URL are not two URLs, and a byte between an autolink's brackets would rewrite where the link goes.
- A `symmetric-pair` kind follows how the caret arrived (`cursor/edge-affinity.ts`, the memory of which side of the edge the caret meant): stepping in from outside types outside, walking out from inside types inside. A click clears the arrival, and the seat's default is the near side, so the construct the caret touches keeps the byte (the gdocs click default).
- A caret seated at an extreme rather than stepped there (Home, End, a selection collapsing onto its own edge, a structural operation landing the caret at a block's start or end) is construct-relative: it means outside the delimiters whatever key produced it. A seat is not a step, so the key's direction is not read.
- Pending marks (§ 4.3) outrank the arrival side: a toggle is the newer instruction about the same bytes.
- An IME run cannot be intercepted per keystroke, so the composed text is relocated once at commit, against the affinity and marks captured at `compositionstart` (`composition-seat.ts`).

What the seat chooses from is the caret's screen POSITION, not one construct's run: a hidden run's hidden neighbours name the same position, so a byte the construct's own edge would break can still land at the boundary of the run beside it. The candidates are tried in order, and a later one is asked only when the painter refuses the ones before:

1. the side the kind's policy names,
2. the same run's other end,
3. the byte-literal write,
4. the neighbouring boundaries nearest the policy's side.

The byte-literal write is verified like every other candidate rather than ending the list, so a parse it rebinds is no reason to stop looking; where it holds, native typing already lands it and the seat stands down. An offset inside a run's own bytes is never a seat, and a `never-extend` construct admits none inside its own bytes at all, whichever run of the position would have offered it.

Where nothing the position admits survives the painter, the byte-literal write stands and the delimiters it surfaces paint (§ 4.4). It takes a contrived shape to get there: in `*www.example.com***a**`, a second delimiter run downstream offers the parse another pairing, so at the emphasis opener the offset outside re-flanks into that pairing and the offset inside kills the URL, and every candidate fails. The same opener in `*www.example.com*` alone has an answer.

### 4.3 Format toggles at a collapsed caret: pending marks

A collapsed-caret toggle in a mode that paints no delimiter cannot write an empty pair (§ 4.1), so it pends the mark instead (`cursor/pending-marks.ts`): the promise is held outside the document and spent by exactly one insertion.

- Resolution is against the caret's construct chain (`pending-mark-insert.ts`): a kind the chain lacks wraps the insertion; a kind it carries escapes it, by close-and-reopen split or by stepping outside the construct.
- The marks ride the edge affinity's invalidation (G4.31), so every seam that drops an arrival side drops them, and a mode flip clears them.
- A composition takes them at its start, ahead of the affinity re-arm that would otherwise drop them mid-window, and hands back what it took if it commits nothing: an IME cancel inserts no run, so the promise is still owed.
- Table cells fork to the same seat.

Over a SELECTION the same chord writes bytes at once, in every mode, and its question is parse coverage rather than edge adjacency: is the selected range covered by a construct of the chord's kind?

Unapplying, when it is:

- The aligned strip goes first: a construct whose delimiters line up with the selection sheds them. Otherwise the construct splits around the selection, each half keeping the construct's own delimiter run and handing a boundary space to the text beside it.
- Where runs of one kind nest, the press owes both directions: every covering run is a candidate, since shedding the inner one alone leaves the outer still covering the range the press just called formatted; and a strip sheds the runs of its own kind inside what it takes, since one left standing there unapplies a whole range only in part.
- A selection taking a construct WHOLE is asked about the content that construct's delimiters enclose, whatever kind it is: the press means the mark on that content, so a run already covering it counts however the parse layered the two around it. That reading is what makes the merged `***ab***` stack read as strong, and a link whose whole text is already marked read as marked.
- A selection lying wholly inside a run's delimiters has no content to unformat, and writes nothing rather than the bytes unchanged with the selection collapsed.

Applying, when it is not:

- A range overlapping or abutting same-format runs applies over their union, dissolving their delimiters into one construct.
- A code span sits the union out, since it holds its bytes literally and a neighbour's fence is honest content inside a wider span.

What every branch obeys:

- None may splice at an endpoint strictly inside another construct's bytes, where a stranded delimiter re-pairs against whatever run the parse finds next.
- Past that, the branches rewriting bytes the user never selected verify before writing, whatever the mode paints: the rendered content unchanged, and the selection's coverage actually flipped. A press whose candidates all fail writes nothing.
- Two branches keep the mode fork, both writing their literal reading where the delimiters PAINT and the reader can see and fix them: the aligned strip, which touches nothing outside the selection and stands down where a second run of its kind covers it, and the bare wrap. Where nothing paints, both take § 2's discipline, the wrap with that same coverage check on top, a boundary space moving outside the run where the literal wrap would break it (the split rebalancer's reading, at the toggle).

### 4.4 Cutting a construct open: splits and destructive presses

What happens to delimiters an edit cuts through or empties:

- Enter inside a `close-and-reopen` construct closes it before the cut and reopens it after, innermost first, so neither half strands a run and a split link carries its destination into both halves (`live-split-rebalance.ts`). A `plain` kind with content declines, and the byte-literal cut stands. Each half must re-parse to one prose block the reload keeps: whitespace-only halves are refused, a boundary space may move outside the runs, and only terminal whitespace the screen never painted may drop.
- A CHILDLESS `never-extend` construct has no interior for a cut to land in at all (two halves of a URL are not two URLs, and half an escape is a literal backslash), so the cut moves to its nearer edge and one half takes the construct whole. Every byte survives, which is what rules out the alternative, dropping the delimiter pair.
- A side left with no content takes the whole construct rather than a pair enclosing nothing.
- A destructive key at a hidden run takes the adjacent content character, never an invisible delimiter byte, plus every delimiter the cut leaves enclosing nothing (`autoUnwrapOnEmpty`, `construct-edge-delete.ts`). A press this branch owns but cannot rewrite soundly takes nothing, since the engine's version would paint the markers. Chrome that paints (§ 4.1) is not a hidden run, so the branch declines the block outright rather than reading its own bytes as unseen.
- A block's own hidden structure gets the same first claim: `contentStartBackspace: 'demote-first'` makes Backspace at a heading's content start give up the `## ` or underline before any merge, the first press a user can aim at markers they cannot see.

The fallback these rules share is § 2's: where no candidate survives the painter, the byte-literal edit is written and the delimiters it surfaces paint, so the reader sees what happened and can undo it. Two shapes reach it: a `plain` construct's split, and a typed byte whose whole screen position rebinds the parse (§ 4.2).

### 4.5 Joins clean their seam

Every destructive join crosses one seam: `cleanJoinedRaw` in `tree-operations/node-ops.ts`, the sole reader of the registered cleaner (`live-join-seam.ts`). The cleanup drops two things: delimiter runs the truncation left unpaired, their partner having gone with the cut, and the closer/opener chain a join brings back to back around nothing, the split's inverse.

- What arrives there: Backspace merges, Delete, range deletes, typing over a selection, cut, and the paste's delete half. A native ranged edit inside one block is re-expressed as a join of what survives on either side, so it crosses the same seam (`live-selection-edit.ts`).
- The range it rewrites comes off the EVENT, since a word or line delete reports one at a collapsed caret where the selection is empty, and every editable prose surface takes that branch (G4.44) rather than a list of input types per surface.
- The license is § 2's: live may drop only what it never showed, verified against what the two sides showed, and otherwise the literal join stands.
- Text the gesture writes AT the seam (a selection typed over, a spellcheck replacement) rides into that verification rather than being spliced in past it, so a run the typed bytes re-pair against is not a stranded one and the literal replace stands.
- § 4.1's residue rule is the second question the verification asks, because the two readings of the stranded runs are ordered least destructive first and the leaner one can leave a construct the cut emptied: a pair over nothing paints nothing, so the screen check alone would take it. Least destructive therefore means fewest runs dropped among the readings that leave none.
- The same rule keeps hidden bytes from surfacing through a join: a block holding hidden structure past its content (a setext heading's underline) declines the merge that would concatenate it into view (`hidden-suffix.ts`).

### 4.6 The link card

Live paints no destination, so the card is the only way to read or rewrite one.

- The focus model: a click on a link opens the card beside a caret that stays the document's; keyboard entry (Mod+K with the caret inside a link, or a selection lying wholly inside one) opens it with focus trapped in the URL field. The two arrivals differ on a live selection because only one of them was asked for: an unsought click must not interrupt a drag, while the chord has already resolved the selection against the construct it opens, so those bytes are the card's own.
- An edit commits one undoable step through the link byte-write seam (G4.34). The card addresses its link by path plus construct start and re-resolves after every commit, since a commit rebuilds the inline DOM.
- A toolbar's pressed paint for the chord resolves that same construct, so it too is live mode's alone, and pressing what it paints enters that link.

Scenarios: `src/lib/e2e/requirements/presentation/live-link-card.md`.

### 4.7 The language chip

The card's second client, over the one hidden run a caret cannot reach at all: a fence line is unlandable once the block has content, so the chip is the way into its info string (the text after the opening ` ``` `, usually a language name).

- It sits at the code box's top-right, outside the walk container, transient on hover or caret-inside, and shows the language as a label in reading mode.
- Enter writes the info span alone through the block's one display-commit entry (G4.24), as one isolated undo entry.

Scenarios: `src/lib/e2e/requirements/blocks/code/language-chip.md`.

## 5. What does not change

- Copy yields the source bytes; reading mode is the one rung that copies rendered text.
- Search matches the source bytes, so a query crossing a construct boundary misses what the screen appears to show.
- The caret lands only where the DOM walk can land it: hidden runs are unreachable, so a block's extremes are its landable bounds, not its raw ends (`cursor/widget-offset.ts`).
- Bytes change only where a rule above says so. A gesture that strands nothing writes exactly what source mode writes, outside § 4.1's painted content-empty chrome, where a block's own structural gate follows the mode and the two rungs diverge.
- Keystroke latency is a gated perf axis with live rows beside their source twins (`performance.md`).
