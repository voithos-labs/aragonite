# Feature: live-mode Enter inside a construct (close and reopen)

A split in live mode cuts bytes the reader cannot see. Splitting `**bold**` down the middle
byte-literally leaves `**bo` above and `ld**` below, and both halves print their stars the
moment the block re-renders — the delimiters the mode exists to hide. The contract: Enter
inside a construct CLOSES it before the cut and REOPENS it after, so each half stands as a
balanced construct of the same kind; a split link duplicates its destination into both halves;
a cut at a construct's edge hands the construct over whole rather than mint an empty pair; and
one `Mod+Z` puts the original block back. Where markdown cannot express a balanced pair the
split falls back to the byte-literal cut — sound, and today's behavior. Driven on
`/test/editor` via `?presentationMode=live` with real Enter keystrokes and a real `Mod+Z`; the
SOURCE is the oracle, since a hidden delimiter and an absent one look identical on screen.

## Happy paths

- Enter in the middle of a bold word yields two blocks, each rendering bold, and the source
  carries a balanced `**` pair in each — no star reaches the screen at any point
- the caret lands in the SECOND block on the character that followed the cut, so typing
  continues inside the reopened construct rather than in front of its delimiters
- Enter in the middle of a link's text yields two links, each carrying the same destination:
  the URL the reader never saw is duplicated rather than lost with the closing half
- Enter inside the italic of a bold-wrapping-italic yields two blocks that are both bold and
  both italic, the runs nesting outermost-first exactly as the original did
- one `Mod+Z` restores the single original block, bytes identical, with the caret back inside it

## Edge cases

- Enter at a construct's content END hands the construct over whole: it stays balanced above and
  the text after it opens the second block, with no `****` residue written at any point
- the content-START mirror is pinned by the unit suite, not here: the caret walk canonicalizes
  that pixel to the construct's OUTER start, so no real gesture reaches the offset where an empty
  pair could be minted — the model-level guard still has to exist, since a plugin can address it
- Enter outside every construct is unchanged by the mode: the bytes cut where the caret is
- source mode is unaffected: the same gesture over the same bytes splits byte-literally, because
  there the delimiters are painted and the user aimed at them

## User interactions

- Real Enter keystrokes, real arrow walks and real clicks only: the rewrite lives under the
  split command, and a programmatic write would bypass the commit ceremony the undo entry rides
- Undo is a real `Mod+Z`, never a programmatic history call
- No composition interaction exists to test: Enter cancels an IME composition before the split
  command runs, so the rewrite never sees composed bytes

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the shared e2e fixture)

## Miss analysis

Nothing pinned the split seam against marker leakage before this file: the wave's earlier
requirements cover typing, toggling and destructive keys at hidden runs, and every one of them
leaves the block boundary where it was. A gesture that MOVES the boundary was the one hole.
