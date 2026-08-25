# Feature: live-mode link card

In live mode a link's destination is not on screen. The construct paints its text and hides
`](url)` entirely, so the one gesture that used to reveal those bytes — putting a caret in them —
now reveals nothing. The card is the replacement: click a rendered link and an anchored
`role="dialog"` opens under it holding the URL, an open-link affordance and a remove-link action.
The click still seats a caret in the document — link TEXT is edited there, not in the card — so the
card opens BESIDE a live caret and waits for the user to step into it. Enter in its field writes the
destination as ONE undo entry, Escape closes without writing (putting the caret back when the card
was holding it), and a press anywhere else closes it the same non-destructive way the search bar
dismisses. A blocked-scheme link renders as an inert span rather than an anchor and
MUST open the card too — editing its URL is the only way a user fixes it. Autolinks are excluded by
construction: their destination IS the text on screen, so the document edits it in place. Driven on
`/test/editor` via `?presentationMode=live` with real clicks, real typing and a real `Mod+Z`; the
SOURCE is the oracle, since a hidden destination and a wrong one look identical on screen. The
chord's create half is `live-link-card-create.md`, its consumption contract
`live-link-card-chord.md`, and the containers it opens inside `live-link-card-containers.md`.

**Standing decision (live-mode.md § 4.4 `autoUnwrapOnEmpty`, reaffirmed with the card).** Deleting a link's last
text character still removes the whole construct, destination included. The card does not change
that: an empty `[](url)` is a link with nothing to click, and leaving one behind would put an
invisible destination in the document with no rendered anchor to open the card on. Recovery is the
ordinary one — `Mod+Z`, which restores the construct whole, url intact.

## Happy paths

- clicking a rendered link opens the card, anchored under the link's own rects rather than at a
  page corner, with the URL field carrying the destination the reader never saw
- the opening click leaves the caret in the link's text, so typing keeps editing the document; the
  card takes focus only once the user steps into it, and Escape from there puts back exactly the
  caret the click seated
- `Mod+K` with a collapsed caret inside a link ENTERS the card — opened with the URL field focused,
  so the trap and Escape's caret restore engage without a mouse; it also enters a card the click
  already opened, which is the case with no remount to key the focus on
- `Mod+K` at a collapsed caret outside every link opens no card and writes nothing (the press is
  still consumed — `live-link-card-chord.md`). Narrowed from "outside every link" when the create
  half shipped (#119): a selection now creates; minting an empty `[](url)` at a bare caret is a
  separate UX decision this pin deliberately does not take
- typing a new URL and pressing Enter rewrites only the destination bytes; the link's text and
  everything around it stay byte-identical
- one `Mod+Z` after that edit puts the original destination back — the whole rewrite is a single
  undo entry, not one per keystroke in the field
- remove-link unwraps the construct to the text the reader was already seeing, and the source keeps
  no bracket, no parenthesis and no destination
- the open-link affordance routes through the url policy rather than the DOM: a consumer's
  `onLinkActivate` sees it, and a blocked scheme is refused there rather than opened

## Edge cases

- a drag-select that starts and ends inside a link's text keeps the selection and opens no card:
  the click fires on the link element, but a live selection is a gesture the card must not
  interrupt — every entry declines at the state's own guard, the chord included
- a blocked-scheme link (`javascript:`) renders as `span.md-link-blocked` with no `href` and still
  opens the card: the card is how its URL gets fixed
- an autolink opens no card at all — there is no hidden destination to edit
- a reference link's URL edit inlines the destination (`[t][ref]` → `[t](new)`) and leaves the
  definition block untouched: the reference form cannot carry a new URL without editing another
  block, so changing it is the user opting into the inline form
- pressing Enter with the URL unchanged writes nothing and adds no undo entry
- an edit landing elsewhere in the document while the card is open re-anchors it rather than
  stranding it: the card addresses its link by path plus construct start, never by element
- an edit that moves the card's OWN construct start closes it, and it stays closed through the
  `Mod+Z` that puts those bytes back: a card left holding a target it no longer renders would
  resurrect with the draft it had before
- a card opened while the search bar is open does not disturb the pre-search caret — each
  chrome surface holds its own slot, so closing the bar lands the caret where the user left it
  rather than at the link
- leaving live mode closes the card, since every other mode paints the destination already

## User interactions

- Real mouse clicks on the rendered link and on the card's buttons; real keystrokes in the field
- Escape is a real key press and the caret it restores is read back through the selection bridge
- Undo is a real `Mod+Z`, never a programmatic history call
- Tab is trapped once focus is inside the card, so the field, open-link and remove-link cycle and
  the document behind never takes the focus mid-edit
- the card is `role="dialog"` WITHOUT `aria-modal`: after a click it sits beside a live caret and
  the document behind is still the user's to type in, which is exactly what `aria-modal` would
  wrongly deny; the trap engages on entry, where the claim is true

## Error cases

- Escape writes nothing: the source after a cancelled edit is byte-identical to the source before
- a press outside the card closes it without writing, and leaves the caret the press just placed
- zero `[invariant:…]` console fires across every scenario (automatic via the shared e2e fixture)

## Miss analysis

Nothing could have caught this before the card existed: live mode shipped the marker hiding that
makes a destination unreachable, and the wave that hid it is the wave that owes the replacement.
The forward-looking hole this file closes is the anchored-chrome one the image popover already had
and nothing pinned — a commit rebuilds the inline DOM, so any overlay holding an element reference
strands itself on the first edit.

Drag-select regression: every pointer row clicked; none dragged, so the click entry's missing
selection guard (which the chord entry carried) was never exercised. The drag itself spans the
whole word: a half-word drag was rect-derived and sat on the CI runner's font-metric knife's
edge, collapsing to a caret there while every local host selected — a gesture asserted
non-collapsed must dwarf the metric variance it is derived from.
