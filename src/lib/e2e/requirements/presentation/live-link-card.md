# Feature: live-mode link card

In live mode a link's destination is not on screen. The construct paints its text and hides
`](url)` entirely, so the one gesture that used to show those bytes, putting a caret in them,
now shows nothing. The card is the replacement: click a rendered link and an anchored
`role="dialog"` opens under it holding the URL, a button that opens the link and a button that
removes it. The click still puts a caret in the document, because a link's text is edited there
and not in the card, so the card opens beside a live caret and waits for the user to step into
it. Enter in its field writes the destination as one undo entry, Escape closes without writing
(putting the caret back when the card was holding it), and a click anywhere else closes it the
same non-destructive way the search bar dismisses. A blocked-scheme link renders as an inert
span rather than an anchor and must open the card too, since editing its URL is the only way a
user fixes it. Autolinks are excluded by construction: their destination is the text on screen,
so the document edits it in place. Driven on `/test/editor` via `?presentationMode=live` with
real clicks, real typing and a real `Mod+Z`; the source is what each scenario checks against,
since a hidden destination and a wrong one look identical on screen. The chord's create half is
`live-link-card-create.md`, its consumption contract `live-link-card-chord.md`, and the
containers it opens inside `live-link-card-containers.md`.

**Standing decision (`live-mode.md` § 4.4 `autoUnwrapOnEmpty`).** Deleting a link's last text
character still removes the whole construct, destination included. The card does not change
that: an empty `[](url)` is a link with nothing to click, and leaving one behind would put an
invisible destination in the document with no rendered anchor to open the card on. Recovery is
the ordinary one: `Mod+Z`, which restores the construct whole, url intact.

## Happy paths

- clicking a rendered link opens the card, anchored under the link's own rects rather than at a
  page corner, with the URL field carrying the destination the user never saw
- the opening click leaves the caret in the link's text, so typing keeps editing the document; the
  card takes focus only once the user steps into it, and Escape from there puts back exactly the
  caret the click placed
- `Mod+K` with a collapsed caret inside a link enters the card, opened with the URL field focused,
  so the focus trap and Escape's caret restore engage without a mouse; it also enters a card the
  click already opened, which is the case with no remount to key the focus on. A selection lying
  wholly inside the link enters the same way, the selection left as it is; the card anchors under
  the link's own rects either way, never under the range
- `Mod+K` at a collapsed caret outside every link opens no card and writes nothing, and the
  keypress is still consumed (`live-link-card-chord.md`). Narrowed from "outside every link" when
  the create half shipped (#119): a selection now creates, while writing an empty `[](url)` at a
  bare caret is a separate UX decision this pin deliberately does not take
- typing a new URL and pressing Enter rewrites only the destination bytes; the link's text and
  everything around it stay byte-identical
- one `Mod+Z` after that edit puts the original destination back: the whole rewrite is a single
  undo entry, not one per keystroke in the field
- remove-link unwraps the construct to the text the user was already seeing, and the source keeps
  no bracket, no parenthesis and no destination
- the button that opens the link routes through the url policy rather than the DOM: a consumer's
  `onLinkActivate` sees it, and a blocked scheme is refused there rather than opened

## Edge cases

- a drag-select that starts and ends inside a link's text keeps the selection and opens no card:
  the click fires on the link element, but a live selection is a gesture an unasked-for card must
  not interrupt, so the click handler declines it at the selection state's own check. The chord
  does not decline, because the user asked for it and the handler has already resolved the
  selection against the construct it opens, so `Mod+K` (or a toolbar button running the same
  command) over a range inside the link enters that link's card. `live-link-card-create.md`
  covers the split between editing and creating
- a blocked-scheme link (`javascript:`) renders as `span.md-link-blocked` with no `href` and still
  opens the card: the card is how its URL gets fixed
- an autolink opens no card at all, since there is no hidden destination to edit
- a reference link's URL edit inlines the destination (`[t][ref]` → `[t](new)`) and leaves the
  definition block untouched: the reference form cannot carry a new URL without editing another
  block, so changing it is the user opting into the inline form
- pressing Enter with the URL unchanged writes nothing and adds no undo entry
- an edit landing elsewhere in the document while the card is open re-anchors it rather than
  stranding it: the card addresses its link by path plus construct start, never by element
- an edit that moves the start of the card's own construct closes it, and it stays closed through
  the `Mod+Z` that puts those bytes back: a card left holding a target it no longer renders would
  come back with the draft it had before
- a card opened while the search bar is open does not disturb the pre-search caret, because each
  piece of the editor's own UI saves its own caret position, so closing the bar lands the caret
  where the user left it rather than at the link
- leaving live mode closes the card, since every other mode paints the destination already

## User interactions

- Real mouse clicks on the rendered link and on the card's buttons; real keystrokes in the field
- Escape is a real keypress and the caret it restores is read back through the selection bridge
- Undo is a real `Mod+Z`, never a programmatic history call
- Tab is trapped once focus is inside the card, so the field, open-link and remove-link cycle and
  the document behind never takes the focus mid-edit
- the card is `role="dialog"` with no `aria-modal`: after a click it sits beside a live caret and
  the document behind is still the user's to type in, which is exactly what `aria-modal` would
  wrongly deny; the focus trap engages once the user steps in, where that claim is true

## Error cases

- Escape writes nothing: the source after a canceled edit is byte-identical to the source before
- a click outside the card closes it without writing, and leaves the caret that click just placed
- zero `[invariant:…]` console fires across every scenario (automatic via the shared e2e fixture)

## Miss-analysis

Nothing could have caught this before the card existed: live mode shipped the marker hiding that
makes a destination unreachable, and the same work that hid it has to provide the replacement.
The gap this file closes ahead of time is the anchored-UI one the image popover already had and
nothing pinned: a commit rebuilds the inline DOM, so any overlay holding an element reference
strands itself on the first edit.

Drag-select regression: every pointer row clicked and none dragged, so the selection check the
click handler was missing, which the chord handler had, was never exercised. The drag itself
spans a whole word: a half-word drag was derived from a rect and sat on the CI runner's
font-metric knife edge, collapsing to a caret there while every local machine selected. A
gesture asserted to be non-collapsed has to be much larger than the metric variance it is
derived from.
