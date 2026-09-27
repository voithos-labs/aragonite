# Feature: an ATX heading's closing run on screen

An ATX heading may end in a closing run of `#`s after a space or tab (GFM §4.2): `# Hi #` is the
heading `Hi`. The page draws the run as a marker after the text, the way it draws the opening `#`:
source mode shows it dimmed, and live mode hides it, so the caret stops at the end of the text.
The run stays on the heading when you break, paste or type inside the text, and an edit that
takes the heading's `#` takes the run with it. Driven on `/test/editor` with `?presentationMode=`
and real keys.

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
- live mode: Backspace over the text's last character leaves the empty paragraph a heading with
  no closing run leaves, and so does a setext heading; the next key writes a plain paragraph
- live mode: selecting the whole text and pressing Backspace leaves an empty paragraph too
- live mode: Shift+Enter inside the text keeps the run on the heading's line (`# H\ #` over `wi`),
  as a heading with no run gives `# H\` over `wi`
- live mode: pasting two paragraphs at the text's end keeps the run on the heading
  (`# Hi #`, then `abc`, `def`), and a setext heading keeps its underline the same way

Miss-analysis for the last four: the Backspace case deleted one of two characters, so the text
never emptied, and no scenario broke or pasted into a heading with structure past its text.

- live mode: Shift+Enter at the text's end, then a key, keeps the run on the heading's line too
  (`# Hi\ #` over `w`), the way `# Hi` gives `# Hi\` over `w`; the caret starts the new line
  first, and a setext heading and a plain paragraph write what they always did
- preview-block: Shift+Enter at the text's end shows the run on the heading's line, not on the
  new line under it

Miss-analysis for the last two: the break at the text's end was only tried on blocks with
nothing past their text, so no scenario saw the run drawn, and then written, on the new line.

- live mode, inside a list item: Backspace over the text's last character keeps both markers
  (`- #  #`), and the next key writes the heading's text between them (`- # k #`)
- live mode: a key typed into an empty heading with a closing run (`#  #`) lands between the
  markers (`# k #`), after End too
- live mode: selecting the whole text and typing a space leaves a paragraph holding the space,
  the way a heading with no run does; the run goes with the `#` (` x` after the next key)

Miss-analysis for the last three: the emptying scenarios ran at the top level only, where the
browser drops the `#` span, so no scenario kept the markers of an empty heading or replaced the
whole text with a key.

## User interactions

- a placed caret, then End, Backspace, Shift+Home, Shift+Enter, a paste and typed keys

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the shared e2e fixture)
