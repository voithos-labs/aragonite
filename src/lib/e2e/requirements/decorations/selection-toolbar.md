# Feature: selection toolbar

The editor's own formatting popover, mounted by `Editor.svelte` in every mode but
reading and turned off by the `selectionToolbar` prop (the `/test/editor` harness
takes the default; `showcase-chrome.md` pins the showcase, which ties it to live
mode). It is built purely on the public API a host's own toolbar would use:
`getEvents().on('selectionChange')` for lifecycle, `getRects().rangeRects` to place it
against both a cross-block and a single-block selection, `normalizeSelection` to order
the endpoints, `getBlockKindAt` to exclude a rectangle inside a table, and the command
API for every button: `runCommand(id)` rather than a synthesized chord, greyed out by
`canRunCommand(id)` and painted pressed by `isCommandActive(id)`. It is a
`position: fixed` card in the shared `.md-menu` styling, opening below and to the
right of the selection.

## Happy paths

- selecting text inside one paragraph opens the toolbar like a menu: below the
  selection's last rect and to the right of where it ends, never over the text
- a cross-block selection places the toolbar the same way, off the rects of the block
  the selection starts in (through the public `rangeRects`)

## Happy paths (state paint)

- a selection inside a bold run paints the bold button pressed (`aria-pressed`, set
  from `isCommandActive`, the state counterpart of the check that says whether a
  command can run) while the other toggles stay unpressed, and a plain selection
  unpresses it
- in live mode a selection inside a link paints the link button pressed, and a
  selection in the plain text beside it unpresses: the link editor is not a mark,
  so its state is the construct its card would edit
- clicking the link button while it paints pressed opens the card for that same
  link, with its URL and the field focused: the painted state and the click resolve
  one construct, so a button that looks pressed is never inert

## User interactions

- collapsing the selection (click) hides the toolbar
- clicking the bold button wraps the selected word: the button cancels its own
  mousedown default, so the caret never leaves the document and the command has a
  focused block to run on
- a selection starting mid-line in a wrapped paragraph places the toolbar at the
  left of rect[0]: the first visual line's geometry, not the union of every line
- a cross-block selection leaves the format toggles live and greys out only the
  link editor: the toggles have a cross-block handler behind them, while the link
  editor works from one block's offsets and a range across blocks gives it none
- a cross-block selection drops the "Set heading" row entirely, and a single-block
  one still offers it: a heading level belongs to one block, so the command declines
  to run across a range, and a labelled row the command declines leaves the bar
  rather than sitting there greyed out (a mark button only dims, which keeps the
  icon bar's shape)
- the "Inline code" row survives the same selection and wraps each block's covered
  run on its own: it has the cross-block handler the other toggles have, so the bar
  offers exactly what the commands accept
- clicking the bold button over a cross-block selection wraps every block the range
  touches, and its `aria-pressed` turns true once they all carry the mark: the
  pressed state is read from the same coverage the click writes
- the strike button over a lone delimiter byte of `~~a ~b~ c~~` leaves the bytes and
  the selection exactly as they were: the bar paints pressed because a run covers
  the byte, and there is no content inside it to unformat
- the strike button over the nested `~b~` splits the outer run around it
  (`~~a~~ b ~~c~~`) and unpresses: shedding only the inner run would leave the
  selection struck through under a bar that just said it was not

- the "Set heading" row opens a picker whose rows run `runCommand('heading.cycle', level)`:
  Heading 2 re-marks the selected block as `## `, Normal text (level 0) strips it back to
  a paragraph, through the same handler the `Mod+0`..`Mod+6` chords take
- the editor's own right-click menu opening over the selection hides the bar (the
  `menuChange` channel), and closing it brings the bar back over the selection that
  still stands

## Edge cases

- a bar with no room below the selection moves above its first rect, and one at the
  right edge of the viewport is pushed left; the top of the editor root, where the
  host's own toolbar ends, is as high as it can go
- the bar is placed again on scroll and resize as well as on selection change, so it
  stays with the text it acts on

## Miss-analysis

- The pressed state was a per-command lookup in the mark rows that returned before
  reading anything, and no scenario at any layer ever asked a command that is not a
  mark what it painted, so every command id with no mark row went unasserted
- Nothing ever clicked a button the state read had just turned on, so the one state
  the showcase can actually paint (a range inside a link, where the create path
  declines the bytes) stayed inert while the suite stayed green
- Nothing clicked a toggle over a selection of delimiter bytes, so a click that
  writes the bytes unchanged, collapses the selection onto a caret and charges an
  undo entry for it had no scenario at any layer (GH #218)
- Every cross-block scenario asked the marks row what it showed and nothing ever
  asked the labelled rows, so the heading picker stayed on offer over a range that
  gave it no single block to act on (GH #324); the census over that code read the
  block vocabulary and never the published toolbar ids, so the handler was recorded
  as safe across a range for a reason that only held inside one block
- Both shapes are source-mode only, which is why they are pinned there alone: in a
  mode that hides markers the caret stops only at visible positions, so a selection
  can open at the inner run's opening delimiter but its next stop is past the
  content, never inside a delimiter run
