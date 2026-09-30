# Feature: table cell inline-format shortcuts

Table cells declare `supportsInline`, so the inline-format keyboard shortcuts
(Mod+B → strong, Mod+I → emphasis) must apply inside a cell exactly as they do
in prose. They go through the cell's keymap and command dispatch; without a
binding on the cell, the chord falls through to the browser, which does nothing.

## Happy paths

- Ctrl+B over a selected word in a cell wraps it in `**…**`
- Ctrl+I over a selected word in a cell wraps it in `*…*`

## Edge cases

- Ctrl+B over already-bold cell content strips the markers (toggle off)
- Ctrl+B at a collapsed caret inserts the empty pair, the same contract prose carries
