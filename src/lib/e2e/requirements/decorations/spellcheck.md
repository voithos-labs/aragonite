# Feature: spell check

Misspelled words in prose get a red wave (a mark decoration from the editor's own source,
`editor:spellcheck`, painted by the shared decoration overlay as `.spell-overlay`), and the
editor offers the fix: the suggestions lead the right-click menu over the word, and a selection
of exactly the word gives the selection toolbar a "Spelling" row with the same list. On by
default with the built-in English dictionary, which the `/test/editor` harness takes;
`?spellcheck=native|off` sets the prop.

## Happy paths

- resting the pointer on a misspelled word for a moment opens a menu of its suggestions alone
  under the word (a mark hover, so the word still takes clicks; a pointer passing over the word
  opens nothing); moving onto the menu keeps it, picking a row rewrites the word, and leaving
  both closes it

- a paragraph with two misspelled words shows two waves, over those words and nothing else; the
  same word inside a code fence shows none
- right-clicking a misspelled word puts its suggestions first, and picking one rewrites that word
  alone, leaving the rest of the paragraph's bytes as they were
- one Ctrl+Z after a pick puts the misspelled word back
- "Add to dictionary" in the right-click menu takes the wave off that word
- selecting exactly a misspelled word shows a "Spelling" row in the selection toolbar whose flyout
  lists the suggestions, and picking one rewrites the word

## While typing

- the word the caret is typing in stays plain; the space after it is what brings the wave, so a
  half-typed word is never red

## The modes (one page load each)

- the default leaves the browser's checker off: every prose surface carries `spellcheck="false"`,
  so a word never gets two underlines
- `spellcheck=native` sets `spellcheck="true"` on the prose surface and draws no waves of its own
- `spellcheck=off` draws none and keeps the browser's off
