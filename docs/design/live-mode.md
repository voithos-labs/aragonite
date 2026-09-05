# Live Mode

`presentationMode="live"` is the fifth rung of the presentation ladder (a rung: one level in an ordered ladder, here the five modes running from raw source up to fully rendered). It hides every Markdown marker standing over content, and nothing brings one back, not even the caret walking into the construct (that's preview-inline's trick). The document stays editable the whole time. Like every rung it's CSS over the one render path (`editor.md` § 4), so the bytes and the offsets are the source document's, same as in every other mode. What live changes is editing. A caret next to a marker it can't see needs answers the other rungs never had to give, and those answers are what this doc catalogues.

A `live-mode.md § 4.x` citation in source or a test resolves to § 4 below, and those numbers never move. Jump by section:

| §                                                                  | Section                             | What's in it                                                                            |
| ------------------------------------------------------------------ | ----------------------------------- | --------------------------------------------------------------------------------------- |
| [1](#1-the-problem)                                                | The problem                         | why a hidden marker is an editing problem and not just a paint one                      |
| [2](#2-the-discipline-candidates-verified-by-the-painter)          | The discipline                      | how every rewrite checks its own bytes before writing them                              |
| [3](#3-policy-is-data)                                             | Policy is data                      | the table where each construct declares what its delimiters do                          |
| [4.1](#41-what-live-never-writes)                                  | What live never writes              | the two prohibitions every rule applies, and a loaded document that already breaks them |
| [4.2](#42-typing-at-a-hidden-edge)                                 | Typing at a hidden edge             | which side of an invisible delimiter a typed byte lands on                              |
| [4.3](#43-format-toggles-at-a-collapsed-caret-pending-marks)       | Format toggles at a collapsed caret | what Mod+B does when there's nothing to show for it, and what it does over a selection  |
| [4.4](#44-cutting-a-construct-open-splits-and-destructive-presses) | Cutting a construct open            | what happens to delimiters an Enter or a delete cuts through or empties                 |
| [4.5](#45-joins-clean-their-seam)                                  | Joins clean their seam              | the cleanup every destructive join runs where two pieces of text meet                   |
| [4.6](#46-the-link-card)                                           | The link card                       | the only way to read or change a link's destination while live paints none              |
| [4.7](#47-the-language-chip)                                       | The language chip                   | the way into a code fence's language label                                              |
| [5](#5-what-does-not-change)                                       | What does not change                | the things live leaves exactly as source mode has them                                  |

Where the same material lives elsewhere:

- `docs/guide/consumer-guide.md` § Presentation modes: the consumer-facing statement of these rules.
- `src/lib/e2e/requirements/presentation/`: the `presentation-live-*` files pin each behavior as e2e scenarios.
- `docs/contributing/codebase-map.md`: where each behavior lives in the code, indexed by behavior.

## 1. The problem

Hiding a marker is easy. Editing next to one nobody can see is where it gets interesting.

Take `Some **bold** text` in live mode. Each `**` (a marker run, from here on: the consecutive delimiter bytes of one inline construct) paints at zero width, so one screen position, the one right after `bold`, names two raw offsets: before the closing `**` and after it. Every delimiter in the document has that shape, and you can type against it, cut through it, or empty what it encloses without ever seeing it. Each rule in § 4 answers one of those cases, and each is applied at one seam (a boundary where responsibility passes from one piece of code to another; the word comes up a lot around here), so it holds for every gesture that reaches the seam instead of being re-implemented per entry path.

## 2. The discipline: candidates, verified by the painter

A live rewrite never trusts its own reading of the bytes. It builds a candidate byte string and asks the render path what that candidate would show, through `renderedText` (`core/inline/visibility.ts`). That function is the one place that decides which spans a mode leaves on screen; the caret walk reads it too, and G4.30 holds the two together (a G-number is an entry in the catalog in `docs/design/invariants.md`). I'll call that check the painter. The rule it enforces: the screen after the write shows exactly what the gesture claimed, and live drops only bytes the reader never saw.

The mode read and the painter, on one block:

```ts
const raw = 'Some **bold** text';
const inlines = parseInline(raw, 0, raw.length);
const live = screenVisibility('live', { chromePaints: false }); // { hidesMarkers: true, chromePaints: false }

renderedText(inlines, raw, live); // 'Some bold text'
renderedText(inlines, raw, screenVisibility('source', { chromePaints: false })); // 'Some **bold** text'
```

The details:

- A rewrite says which reading it wants. Either the block's own screen, as above, which decides what a press may touch; or `CONTENT_VISIBILITY`, the content behind every marker family whatever the block paints (a marker family: one class of marker the renderer paints, so emphasis delimiters, fence lines, reference labels). The second reading is for a before/after diff: the content shown before the rewrite has to equal the content shown after it (G4.33).
- The content reading is only honest where the block's chrome is hidden (chrome: a block's marker furniture, the `# ` or the fence line, as opposed to its content). Over chrome the reader is looking at, it would call those bytes unseen and hand the rewrite permission to drop them, so every seam that takes it first declines a side whose chrome paints.
- A candidate that fails isn't written; the byte-literal edit stands. That's the fallback every seam has, never a guess, and it may put markers on screen (a `plain` construct's split is the known case) rather than drop a byte the reader saw.

## 3. Policy is data

How a construct behaves at its hidden edges is one row in the inline-construct policy table (`schema/inline-construct-policy.ts`). Seams read rows, never lists of kinds, so a new markable construct costs a row and not a new case at every toggle surface.

```ts
getInlineConstructPolicy('strong');
// { edgeAffinity: 'symmetric-pair', autoUnwrapOnEmpty: true, splitBehavior: 'close-and-reopen',
//   revealable: true, mark: { nestingRank: 0, markerBytes: '**', command: 'format.toggleStrong' } }
getInlineConstructPolicy('link');
// { edgeAffinity: 'never-extend', autoUnwrapOnEmpty: true, splitBehavior: 'close-and-reopen',
//   revealable: true, cardEditable: true }
getInlineConstructPolicy('text'); // undefined: no row, so no live-mode behavior at all
```

Field by field:

- `edgeAffinity`: which side of the delimiters a typed byte lands on (§ 4.2).
- `autoUnwrapOnEmpty`: whether emptying the construct takes its delimiters with it (§ 4.4).
- `splitBehavior`: what Enter inside it does (§ 4.4).
- `revealable`: whether preview-inline may show its markers when the caret enters.
- `cardEditable`: whether the link card (§ 4.6) is the way to its destination.
- `mark`: what a format chord writes for it. The delimiter run, the rank it nests at when one insertion carries several marks, the command that toggles it, and a wrap function for a kind whose delimiters depend on what they enclose (a code span sizes its backtick fence past the longest run inside it).

The same table holds the two registered rewrite slots, the split rebalancer (§ 4.4) and the join-seam cleaner (§ 4.5). Each slot holds one function for every construct, and each has exactly one reader, in `tree-operations/node-ops.ts`.

Two things stay outside the table on purpose, and a lint (`test/invariants/lint/policy-arm-census.test.ts`, which keeps the table and its readers in agreement) records both with their reasons so they can't drift:

- The caret-edge dispatch's branch list. That's a total order over gesture FAMILIES (which press wins when several could claim the key), a different question from a per-construct row.
- Whether a destructive key or a join takes a construct whole. That's a per-NODE fact, not a per-kind one: an empty link `[](url)` paints nothing though its kind normally encloses content, and an image's alt text is content though the kind renders as an atomic island (an island: a `contenteditable="false"` widget the caret can't enter). The inline-widget registry is the second table, and it answers the island question. `image` sits in both, legitimately, and the lint asserts the boundary by naming every file that reads either.

## 4. The editing rules

Seven rules, one per gesture, each cited from source and tests by its number (the map up top links them).

### 4.1 What live never writes

Two prohibitions, and every rule below applies them:

- **No invisible residue.** A delimiter pair enclosing nothing paints as nothing, so live never writes one, and removes one wherever an edit would create it.
- **No unverified drop.** Bytes leave the document only when the painter confirms the reader never saw them (§ 2).

A document can already hold such residue when it loads: a `#` typed before its heading has a word, a fence before its first body line, a loaded `[](url)`. There the prohibition falls on the paint rather than the bytes. Chrome may hide only while it stands over content, so a construct with none shows its markers dimmed, exactly as source mode shows them.

```ts
const empty = '[](https://x.example)';
paintsOnlyChrome(parseInline(empty, 0, empty.length), empty); // true: nothing behind the chrome
renderedText(parseInline(empty, 0, empty.length), empty, screenVisibility('live', { chromePaints: true }));
// '[](https://x.example)': the markers paint, dimmed

const full = '[x](https://x.example)';
paintsOnlyChrome(parseInline(full, 0, full.length), full); // false: the chrome hides
```

The painted state decides three things: where a caret can land, which side an inserted byte lands on, and what a destructive key next to the construct may take. A painted delimiter is a byte the reader saw, so § 2's license to drop it doesn't apply and the press stays the browser's. A block's OWN structural gate reads the mode instead, so the rungs still differ there: Backspace at raw offset 0 of a painted `# ` takes the whole construct in one undoable press and leaves an empty paragraph, where source mode at the same offset leaves the document alone.

The wiring, for the curious:

- Each block surface stamps the content-empty condition on its walk container (the contenteditable element the caret geometry reads) on every render, and the two consumers of the hiding rule, the stylesheet and `cursor/widget-offset.ts`, read that stamp under the same modes and over the same marker families.
- The preview rungs take the same rule; reading mode doesn't, since it takes no keystrokes.
- Without the rule such a block would have no landable caret position at all, which G1.33 refuses at the focus entry every caret route crosses.

### 4.2 Typing at a hidden edge

A byte typed where a marker run sits is placed by the edge seat (`components/blocks/text/edge-seat.ts`), which reads the kind's policy first and how the caret arrived second.

- A `never-extend` kind (link, autolink, image, escape, hard break) seats the byte outside its delimiters, whichever side that lands on. Two halves of a URL are not two URLs, and a byte between an autolink's brackets would rewrite where the link goes.
- A `symmetric-pair` kind follows how the caret arrived (`cursor/edge-affinity.ts`, the memory of which side of the edge the caret meant): stepping in from outside types outside, walking out from inside types inside. A click clears that memory, and with nothing on record the seat picks the near side, so the construct the caret touches keeps the byte (the Google Docs click default).
- A caret seated at an extreme rather than stepped there (Home, End, a selection collapsing onto its own edge, a structural operation landing the caret at a block's start or end) means outside the delimiters, whatever key produced it. The caret took no step, so the key's direction isn't read.
- Pending marks (§ 4.3) outrank the arrival: a toggle is the newer instruction about the same bytes.
- An IME run can't be intercepted per keystroke, so the composed text is moved once at commit, against the arrival and marks captured at `compositionstart` (`composition-seat.ts`).

The arrival and the seat, on § 2's block (`raw`, `inlines` and `live` as there):

```ts
classifyArrivalKey('ArrowRight'); // 'near': a step stops on the side it came from
classifyArrivalKey('ArrowLeft'); // 'far'
classifyArrivalKey('End'); // 'outside': a seat, not a step

// the caret sits right after 'bold': one screen position, two raw offsets
seatOffsetsAt(11, inlines, raw, live); // [11, 13]
resolveEdgeSeat(11, inlines, 'far', raw, live, 'X'); // { offset: 13, kind: 'strong' }: 'Some **bold**X text'
resolveEdgeSeat(11, inlines, 'near', raw, live, 'X'); // null: inside, which is where native typing lands anyway
resolveEdgeSeat(11, inlines, null, raw, live, 'X'); // null: nothing on record, so the near side wins

// a link never extends, whatever the arrival
const link = 'see [here](https://x.example) now';
resolveEdgeSeat(9, parseInline(link, 0, link.length), 'near', link, live, 'X'); // { offset: 29, kind: 'link' }
```

What the seat chooses from is the caret's screen POSITION, not one construct's run. A hidden run's hidden neighbours name the same position, so a byte the construct's own edge would break can still land at the boundary of the run beside it. The candidates are tried in order, and a later one is asked only when the painter refuses the ones before it:

1. the side the kind's policy names,
2. the same run's other end,
3. the byte-literal write,
4. the neighbouring boundaries nearest the policy's side.

The byte-literal write is verified like every other candidate rather than ending the list, so a parse it rebinds is no reason to stop looking. Where it holds, native typing already lands it and the seat stands down (that's the `null` above). An offset inside a run's own bytes is never a seat, and a `never-extend` construct admits none inside its own bytes at all, whichever run of the position would have offered it.

Where nothing the position admits survives the painter, the byte-literal write stands and the delimiters it surfaces paint (§ 4.4). It takes a contrived shape to get there. In `*www.example.com***a**`, a second delimiter run downstream offers the parse another pairing, so at the emphasis opener the outside offset pairs the `*` with that later run and the inside offset kills the URL, and every candidate fails. The same opener in `*www.example.com*` alone has an answer.

### 4.3 Format toggles at a collapsed caret: pending marks

A collapsed-caret toggle (Mod+B with nothing selected) in a mode that paints no delimiter can't write an empty pair (§ 4.1), so it pends the mark instead (`cursor/pending-marks.ts`): a promise held outside the document and spent by exactly one insertion.

```ts
flipMark(null, 'strong'); // Set { 'strong' }: Mod+B, once
flipMark(new Set(['strong']), 'strong'); // null: Mod+B again, and nothing is pending

// the next typed byte spends it, wrapped or escaped depending on where the caret sits (raw, inlines: § 2's block)
resolveMarkedInsertion('Some text', 5, 'X', new Set(['strong']), parseInline('Some text', 0, 9));
// { raw: 'Some **X**text', caret: 8 }
resolveMarkedInsertion(raw, 9, 'X', new Set(['strong']), inlines); // inside 'bold'
// { raw: 'Some **bo**X**ld** text', caret: 12 }: closed and reopened around the byte
resolveMarkedInsertion(raw, 11, 'X', new Set(['strong']), inlines); // at bold's end
// { raw: 'Some **bold**X text', caret: 14 }: stepped outside instead
```

- The mark resolves against the caret's construct chain (`pending-mark-insert.ts`; the chain is every construct enclosing the caret, outermost first). A kind the chain lacks wraps the insertion; a kind it carries escapes it, by close-and-reopen or by stepping outside the construct, as above.
- The marks ride the edge affinity's invalidation (G4.31): whatever settles the arrival side clears them too, and a mode flip clears them.
- A composition takes them at `compositionstart`, ahead of the affinity reset that would otherwise drop them mid-composition, and hands them back if it commits nothing: an IME cancel inserts no text, so the promise is still owed.
- A table cell's typing goes through the same seat, so all of this holds in a cell.

Over a SELECTION the same chord writes bytes at once, in every mode. Its question is coverage rather than edge adjacency: is the selected range already covered by a construct of the chord's kind?

Unapplying, when it is:

- The aligned strip goes first: a construct whose delimiters line up with the selection sheds them. Otherwise the construct splits around the selection, each half keeping the construct's own delimiter run and handing a boundary space to the text beside it.
- Where runs of one kind nest, the press owes both directions. Every covering run is a candidate, since shedding only the inner one leaves the outer still covering the range the press just called formatted; and a strip sheds the runs of its own kind inside what it takes, since one left standing there unapplies the range only in part.
- A selection taking a construct WHOLE is asked about the content that construct's delimiters enclose, whatever kind it is. The press means the mark on that content, so a run already covering it counts however the parse layered the two. That reading is what makes `***ab***` read as strong, and a link whose whole text is already marked read as marked.
- A selection lying wholly inside a run's delimiters has no content to unformat, and writes nothing (not the same bytes back with the selection collapsed).

Applying, when it isn't:

- A range overlapping or abutting same-format runs applies over their union, dissolving their delimiters into one construct.
- A code span sits the union out, since it holds its bytes literally and a neighbour's backtick is honest content inside a wider span.

What every branch obeys:

- None may splice at an endpoint strictly inside another construct's bytes, where a stranded delimiter would re-pair against whatever run the parse finds next.
- Past that, the branches rewriting bytes the user never selected verify before writing, whatever the mode paints: the rendered content unchanged, and the selection's coverage actually flipped. A press whose candidates all fail writes nothing.
- Two branches keep the mode fork and write their literal reading where the delimiters PAINT, so the reader can see and fix them: the aligned strip, which touches nothing outside the selection and stands down where a second run of its kind covers it, and the bare wrap (applying to a range no run touches, by wrapping it). Where nothing paints, both take § 2's discipline, the wrap with that coverage check on top, and a boundary space moves outside the run where the literal wrap would break it (the split rebalancer's reading, at the toggle).

### 4.4 Cutting a construct open: splits and destructive presses

What happens to delimiters an edit cuts through or empties. Splits first:

```ts
const node = parse('Some **bold** text\n').children[0];
rebalanceLiveSplit(node, 9, 'Some **bo\n', 'ld** text\n', undefined);
// { firstRaw: 'Some **bo**\n', secondRaw: '**ld** text\n' }: closed before the cut, reopened after

const link = parse('see [here](https://x.example) now\n').children[0];
rebalanceLiveSplit(link, 6, 'see [h\n', 'ere](https://x.example) now\n', undefined);
// { firstRaw: 'see [h](https://x.example)\n', secondRaw: '[ere](https://x.example) now\n' }

const auto = parse('see <https://x.example> now\n').children[0];
rebalanceLiveSplit(auto, 8, 'see <htt\n', 'ps://x.example> now\n', undefined);
// { firstRaw: 'see \n', secondRaw: '<https://x.example> now\n' }: the cut moved to the nearer edge

const image = parse('a ![alt](i.png) b\n').children[0];
rebalanceLiveSplit(image, 5, 'a ![a\n', 'lt](i.png) b\n', undefined); // null: a plain kind, so the literal cut stands
```

- Enter inside a `close-and-reopen` construct closes it before the cut and reopens it after, innermost first, so neither half strands a run, and a split link carries its destination into both halves (`live-split-rebalance.ts`). A `plain` kind with content declines, and the byte-literal cut stands.
- Each half has to re-parse to one prose block a reload of the file would keep: whitespace-only halves are refused, a boundary space may move outside the runs, and only terminal whitespace the screen never painted may drop.
- A CHILDLESS `never-extend` construct (an autolink, an escape) has no interior for a cut to land in at all. Two halves of a URL are not two URLs, and half an escape is a literal backslash, so the cut moves to its nearer edge and one half takes the construct whole. Every byte survives, which is what rules out the alternative, dropping the delimiter pair.
- A side left with no content takes the whole construct rather than a pair enclosing nothing.

Then the destructive presses (`live` as in § 2):

```ts
const press = (display: string, caret: number, direction: 'backward' | 'forward') =>
	resolveEdgeDeletion({
		display,
		content: { start: 0, end: display.length },
		caret,
		direction,
		screen: live,
		inlines: parseInline(display, 0, display.length),
		installedAs: 'block'
	});

press('Some **bold** text', 13, 'backward'); // { raw: 'Some **bol** text', caret: 10 }: the content byte, never the run
press('Some **bold** text', 5, 'forward'); // { raw: 'Some **old** text', caret: 5 }
press('Some **b** text', 10, 'backward'); // { raw: 'Some  text', caret: 5 }: the cut emptied the pair, so the pair went too
press('Some **bold** text', 9, 'backward'); // null: no hidden run beside the cut, so the press is the browser's
```

- A destructive key at a hidden run takes the adjacent content character, never an invisible delimiter byte, plus every delimiter the cut leaves enclosing nothing (`autoUnwrapOnEmpty`, `construct-edge-delete.ts`).
- A press this branch owns but can't rewrite soundly takes nothing, since the browser's version would paint the markers.
- Chrome that paints (§ 4.1) isn't a hidden run, so the branch declines the block outright rather than reading its own bytes as unseen.
- A block's own hidden structure gets the same first claim: `contentStartBackspace: 'demote-first'` makes Backspace at a heading's content start give up the `## ` or the underline before any merge. That's the first press a user can aim at markers they can't see.

The fallback these rules share is § 2's. Where no candidate survives the painter, the byte-literal edit is written and the delimiters it surfaces paint, so the reader sees what happened and can undo it. Two shapes reach it: a `plain` construct's split, and a typed byte whose whole screen position rebinds the parse (§ 4.2).

### 4.5 Joins clean their seam

Every destructive join crosses one seam, `cleanJoinedRaw` in `tree-operations/node-ops.ts`, the sole reader of the registered cleaner (`live-join-seam.ts`). The cleanup drops two things: delimiter runs the truncation left unpaired, their partner having gone with the cut, and the closer/opener chain a join brings back to back around nothing, which is the split's inverse.

```ts
// Backspace between the two halves § 4.4 made
const first = parse('Some **bo**\n').children[0];
const second = parse('**ld** text\n').children[0];
const join = {
	mergedRaw: 'Some **bo****ld** text\n',
	seam: 11,
	start: { node: first, offset: 11 },
	end: { node: second, offset: 0 },
	linkRef: undefined
};
cleanJoinedRaw(join, 'live'); // { raw: 'Some **bold** text\n', seam: 9 }: the split's inverse
cleanJoinedRaw(join, 'source'); // { raw: 'Some **bo****ld** text\n', seam: 11 }: the literal join, as in every other mode

// a range delete inside one block: 'Some **bold** text' with 'ld** text' selected
const node = parse('Some **bold** text\n').children[0];
const gone = (from: number, to: number, mergedRaw: string) => ({
	mergedRaw,
	seam: from,
	start: { node, offset: from },
	end: { node, offset: to },
	linkRef: undefined
});
cleanJoinedRaw(gone(9, 18, 'Some **bo\n'), 'live'); // { raw: 'Some bo\n', seam: 7 }: the opener lost its partner, so it goes
cleanJoinedRaw(gone(7, 11, 'Some **** text\n'), 'live'); // { raw: 'Some  text\n', seam: 5 }: 'bold' selected, and the emptied pair goes with it
```

- What arrives here: Backspace merges, Delete, range deletes, typing over a selection, cut, and the delete half of a paste. A native ranged edit inside one block is re-expressed as a join of what survives on either side, so it crosses the same seam (`live-selection-edit.ts`).
- The range it rewrites comes off the EVENT, since a word or line delete reports one at a collapsed caret where the selection is empty, and every editable prose surface takes that branch (G4.44) rather than keeping its own list of input types.
- The license is § 2's: live drops only what it never showed, verified against what the two sides showed, and otherwise the literal join stands.
- Text the gesture writes AT the seam (a selection typed over, a spellcheck replacement) rides into that verification rather than being spliced in past it. A run the typed bytes re-pair against isn't stranded, so there the literal replace stands: select `bold` in the last example, type `x`, and both runs stay, since the `x` lands between them and pairs them up again.
- § 4.1's residue rule is the second question the verification asks. The two readings of the stranded runs are ordered least destructive first, and the leaner one can leave a construct the cut emptied: a pair over nothing paints nothing, so the screen check alone would accept it. Least destructive therefore means fewest runs dropped among the readings that leave no residue.
- The same rule keeps hidden bytes from surfacing through a join: a block holding hidden structure past its content (a setext heading's underline) declines the merge that would concatenate it into view (`hidden-suffix.ts`).

### 4.6 The link card

Live paints no destination, so the card is the only way to read or rewrite one.

- The focus model: a click on a link opens the card beside a caret that stays the document's. Keyboard entry (Mod+K with the caret inside a link, or a selection lying wholly inside one) opens it with focus trapped in the URL field. The two differ on a live selection because only one of them was asked for: an unsought click mustn't interrupt a drag, while the chord has already resolved the selection against the construct it opens, so those bytes are the card's own.
- An edit commits one undoable step through the link byte-write seam (G4.34). The card addresses its link by path plus construct start and re-resolves after every commit, since a commit rebuilds the inline DOM.
- A toolbar's pressed paint for the chord resolves that same construct, so it too is live mode's alone, and pressing what it paints enters that link.

Scenarios: `src/lib/e2e/requirements/presentation/live-link-card.md`.

### 4.7 The language chip

The card's second client, for the one hidden run a caret can't reach at all. A fence line is unlandable once the block has content, so the chip is the way into its info string (the text after the opening ` ``` `, usually a language name).

- It sits at the code box's top-right, outside the walk container, shows on hover or while the caret is inside, and in reading mode it's a plain language label.
- Enter writes the info span alone through the block's one display-commit entry (G4.24), as one isolated undo entry.

Scenarios: `src/lib/e2e/requirements/blocks/code/language-chip.md`.

## 5. What does not change

- Copy yields the source bytes; reading mode is the one rung that copies rendered text.
- Search matches the source bytes, so a query crossing a construct boundary misses what the screen appears to show.
- The caret lands only where the DOM walk can land it: hidden runs are unreachable, so a block's extremes are its landable bounds, not its raw ends (`cursor/widget-offset.ts`).
- Bytes change only where a rule above says so. A gesture that strands nothing writes exactly what source mode writes, except at § 4.1's painted content-empty chrome, where a block's own structural gate follows the mode and the two rungs diverge.
- Keystroke latency is a gated perf axis, with live rows beside their source twins (`performance.md`).
