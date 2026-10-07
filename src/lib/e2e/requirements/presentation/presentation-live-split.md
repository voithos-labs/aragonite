# Feature: live-mode Enter inside a construct (close and reopen)

A split in live mode cuts bytes the user cannot see. Splitting `**bold**` down the middle
byte-literally leaves `**bo` above and `ld**` below, and both halves print their stars the
moment the block re-renders: the delimiters the mode exists to hide. The contract: Enter
inside a construct closes it before the cut and reopens it after, so each half stands as a
balanced construct of the same kind; a split link duplicates its destination into both halves;
a cut at a construct's edge hands the construct over whole rather than create an empty pair; and
one `Mod+Z` puts the original block back. Where Markdown cannot express a balanced pair the
split falls back to the byte-literal cut, which is sound and is today's behavior. One measured
shape takes that fallback and so still prints its markers: a code span whose reopened fence would
abut a backtick (``a`b``). Driven on
`/test/editor` via `?presentationMode=live` with real Enter keystrokes and a real `Mod+Z`; the
source is what each scenario checks against, since a hidden delimiter and an absent one look
identical on screen.

## Happy paths

- Enter in the middle of a bold word yields two blocks, each rendering bold, and the source
  carries a balanced `**` pair in each: no star reaches the screen at any point
- the caret lands in the second block on the character that followed the cut, so typing
  continues inside the reopened construct rather than in front of its delimiters
- Enter inside a reference link's text yields two links on the same label: the resolver rides the
  split call, so the split reads the construct the render path drew instead of a pair of brackets
- one `Mod+Z` restores the single original block, bytes identical, with the caret back inside it

Four more are pinned below the browser, in `src/lib/test/blocks/text/live-split-rebalance.test.ts`
(the rewrite) and `src/lib/test/tree-operations/live-split.test.ts` (the split and the merge that
carry it). Enter in a link's text gives two links on the same destination, so the URL the user
never saw is copied rather than lost. Enter in the italic of a bold-wrapping-italic gives two
halves that are both bold and both italic, nesting outermost-first like the original. Enter
outside every construct cuts where the caret is, as if the mode weren't there. And Enter then
Backspace round-trips: the join drops the closing and reopening runs that meet there, so
`Some **bo|ld** text` comes back byte-identical and a split link comes back as one link (the
leftover a byte-literal merge would leave is what `live-mode.md` § 4.4 calls impossible in live
editing).

## Edge cases

- Enter at a construct's content end hands the construct over whole: it stays balanced above and
  the text after it opens the second block, with no `****` residue written at any point
- the content-start mirror is pinned by the unit suite, not here: the offset traversal resolves
  that pixel to the construct's outer start, so no real gesture reaches the offset where an empty
  pair could be created. The model-level check still has to exist, since a plugin can address it
- a cut through a childless never-extend construct (`<https://ex|ample.com>`) moves to the
  construct's nearer edge, so one half takes it whole and no delimiter reaches the screen. Two
  halves of a URL are not two URLs, so close-and-reopen cannot apply; dropping the `<`/`>` pair is
  refused by the stronger rule that a live split may lose no byte but a line ending, and moving
  the cut is the reading that satisfies both
- a cut that would strand a block's trailing whitespace drops those bytes instead of carrying
  them: they are a hard break with no line after them, so they paint nothing. Carried along, the
  pair reloads as a different shape (#106), and falling back to the byte-literal cut prints the
  delimiters the user never saw. The screen after the split and the screen after a reload both
  show none. The join and delete path carries the same rule (#113, pinned by its own unit suite);
  the fresh-seed property lane can still go red on that signature through #129, the
  suffix-materialization hole, which is independent of the mode and is no one path's to close
- a cut that would leave a delimiter run against whitespace moves the space outside the run rather
  than killing the construct: `**a *|ital* b**` gives `**a** ` and `***ital* b**`, which read
  identically on screen and parse back, where the literal `**a **` would print its stars
- source mode is unaffected: the same gesture over the same bytes splits byte-literally, because
  there the delimiters are painted and the user aimed at them
- Enter just before a construct (a code span, a bold run, a code span opening a list item's text)
  cuts no construct, so nothing reopens and the landing is structural: the next byte lands before
  the construct in live and in preview-inline (``Y`code` z``, `Y**bold** z`). Miss-analysis:
  every landing row split inside a construct, where typing continues inside the reopened one, so
  no row asked where a split that reopened nothing puts the next byte
- in a list item, `- **bo ld**` cut after `bo` writes `- **bo**` and `-  **ld**`. The space the
  second half starts with stays, and the new item reads it the way a reload does, as part of a
  wider `-  ` marker, so the tree matches the reload and `ld` is still bold

## User interactions

- Real Enter keystrokes, real arrow steps and real clicks only: the rewrite lives under the
  split command, and a programmatic write would bypass the commit sequence the undo entry rides
- Undo is a real `Mod+Z`, never a programmatic history call
- No composition interaction exists to test: Enter cancels an IME composition before the split
  command runs, so the rewrite never sees composed bytes

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the shared e2e fixture)

## Miss-analysis

Nothing pinned the split against markers leaking before this file: the earlier requirements in
this batch cover typing, toggling and destructive keys at hidden runs, and every one of them
leaves the block boundary where it was. A gesture that moves the boundary was the one hole.

The list item row: every split here cut a top-level paragraph, where both halves read the same as
a fragment, so nothing split inside a list item, where the second half becomes a new item's first
line and a leading space widens its marker.
