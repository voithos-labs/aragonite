# Feature: an ATX heading's closing run on screen

An ATX heading may end in a closing run of `#`s after a space or tab (GFM §4.2): `# Hi #` is the
heading `Hi`. The page draws the run as a marker after the text, the way it draws the opening `#`:
source mode shows it dimmed, and live mode hides it, where the text's end is the block's end for
the caret. Driven on `/test/editor` with `?presentationMode=` and real keys.

Miss-analysis: the heading's text ran to the line's end, so the run was drawn as heading text and
every scenario typed headings without one (GH #568).

## Happy paths

- source mode shows `# Hi #` whole; live mode shows `Hi`
- live mode: End then a typed key writes before the run (`# Hix #`)

## Edge cases

- live mode: End then Backspace takes the text's last character and keeps the run (`# H #`)
- live mode: a space typed at the text's end stays text, so the next key follows it
  (`# Hi x #`)
- live mode: typing ` #` after the text makes a closing run, and the next key turns it back into
  text (`# Hi #t`)

## User interactions

- a placed caret, then End, Backspace and typed keys

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the shared e2e fixture)
