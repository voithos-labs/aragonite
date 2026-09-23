# Presentation: the kind cue

In a mode that hides markers, a keystroke can turn its block into another kind with nothing on
screen to say why: a tab at the start of a line makes a code block, `# ` makes a heading. The
editor names the new kind at the block's corner for about a second, a dimmed label that fades,
and the screen reader hears the same name once. The label is the block's accessible name, the
one the block menu uses. Source mode shows the markers that explain the change, so it gets no
cue, and a command, a paste or a menu pick is something the user asked for by name, so they get
none either.

Miss-analysis: nothing reported a typed kind change, and every live-mode spec asserted bytes and
kinds, which were right; what was missing was a cause on screen, which no assertion looked for.

## Happy paths

- Tab at the start of `notes` in live mode makes indented code; the block's host carries
  `data-kind-cue="Code block"`, the kind announcer reads `Code block`, and the attribute is gone
  once the fade ends.
- `# ` typed at the start of `notes` in live mode makes a heading; the cue and the announcer read
  `Heading level 1`.

## Edge cases

- the same `# ` in source mode changes the kind with no cue and no announcement.
- `Mod+2`, a command, changes the kind with no cue and no announcement.
- `# ` then an undo inside the fade: the paragraph that comes back carries no heading cue.
  Miss-analysis: every case left the cued block in place, so none saw a label keyed by position
  outlive the kind it named.
- a bare `#` still paints as the paragraph it was, so it shows no cue (unit: `kind-cue.test.ts`).

## User interactions

- a click into the block, Home, then real key presses and typed characters.
