# Feature: a closer-shaped line typed into a ```math source

The ```math fence holds its own source, so a body line the user types that reads as the fence's
closer (three backticks) would end the block early on commit and leave an empty code block behind
it. The block's commit goes through the content write, which runs the fence's write rule: it grows
both fence runs past the typed line, as it does for a code block, and the block stays one math
fence (GH #593).

Fixture: `Before` / a ```math fence / `After` (`?seed=mathfence`), in source and live mode.

Miss-analysis: the fence rule's routes were driven from outside the block (find and replace, a
range delete), and the leaf's own commit never reached the rule, so no scenario typed into the
source a line the rule has to answer for.

## Happy paths

- open the source from the paragraph above, put the caret at the end of the body line, press
  Enter and type three backticks one at a time: the shown source holds them as typed
- leaving the source commits it with both fence runs grown to four backticks, the typed line kept
  as body, and the block is still a math fence that round-trips

## Edge cases

- the paragraphs on either side keep their bytes

## User interactions

- real clicks, arrow keys, End, Enter and key presses one at a time; the commit is a click on the
  paragraph below

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the shared e2e fixture)
