# Feature: code block navigation in live mode

Live mode hides a fence's opener and closer lines, so the block's landable bounds are its body's
(`cursor/widget-offset.ts`), and every door that seats or moves the caret reads those bounds
rather than the raw's ends: a press at the body start is a press at the block's start, a press
at the body end is one at its end, and no line extreme or edge press reaches a hidden fence line.
Source mode's twins live in `editing-block-exit.md` and `editing-keyboard.md`.

Fixture: `Before` / a two-line `js` fence / `After`, in `?presentationMode=live`.

## Happy paths

- ArrowRight from the end of the block above lands at the body start; typed text leads the
  first body line
- ArrowLeft at the body start leaves to the end of the block above
- ArrowRight at the body end leaves to the start of the block below
- ArrowLeft from the start of the block below lands at the body end
- ArrowDown from above walks the body lines and leaves below after the last; ArrowUp mirrors it
- Home on the first body line seats at its column 0, never inside the hidden opener
- End on the last body line seats after its last byte, never past the hidden closer
- Enter at the body end opens a line inside the fence; a second Enter on that empty line leaves
  the block, taking the empty line with it, and typing lands in the block below
- A closer typed on that empty line leaves the same way: the hidden closer is already there, so
  the run is the exit and none of its bytes land, and the caret arrives in the block below
- Tab at a body line start indents the line, as it does in source mode

## Edge cases

- Backspace at the body start leaves upward and the fence stays whole
- Backspace on the last byte of a one-character body empties the body without reaching the
  opener line (Chromium removes the unrendered nodes beside the last visible character), keeps
  the block a fence, and opens no language picker
- An empty fence (an opener line straight over its closer) completes as the caret arrives, from
  either side: opener, one empty body line, closer. A caret that STEPPED in is passing through, so no
  language picker opens to take its focus: ArrowRight from above then types into that line;
  ArrowLeft from below enters it, and a second ArrowLeft leaves to the block above
- The empty body line's far side is the hidden closer's line, which nothing paints: the walk's
  landable end stops before that newline, so ArrowRight and ArrowDown on the empty line leave
  the block instead of seating a caret the engine cannot show

## Miss-analysis

- The exit gestures pinned here were all keys with no bytes of their own (Enter, the arrows), so
  the one that types something a fence line could be read as went unasked in both modes.
- Every code navigation scenario ran in source mode, where the fence lines paint and the raw's
  ends are landable, so a door reading `0`/`length` instead of the landable bounds passed every
  gate; the hidden-fence shape had no scenario of its own.
- The landable-bounds cases all ended their text on a character, so the position after a final
  newline, which is the hidden closer's line, was never asked for; and the language offer was
  pinned by clicking in, where no arrival key is noted, so a keyboard walk never met the picker.
