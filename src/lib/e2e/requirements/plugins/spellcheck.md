# Feature: spell check

The spellcheck package (`@voithos-labs/aragonite-spellcheck`) on `/test/editor?spell=on`, which
keeps added words in localStorage, or `?spell=bare`, which keeps none. A misspelled word in prose
gets a red wave, and its Spelling rows (the suggestions, then "Add to dictionary" where the host
keeps words) show in the right-click menu, in the selection toolbar, and on a hover card. Every
row waits for the editor to read blocks and paint, so both groups are parked until then.

## The spelling rows

- lead the right-click menu with a divider: right-clicking a misspelled word puts its suggestions
  first, a divider after them, the clipboard rows below; picking one rewrites that word alone, and
  one Ctrl+Z puts it back
- offer Add to dictionary only where the host keeps words, and it settles the word: with a store
  the row takes the wave off the word and the next right-click offers no suggestions for it,
  writing nothing; with no store the suggestions show and the row doesn't
- give a selection of exactly the word a Spelling row in the toolbar, whose flyout rewrites it:
  three of the word's four letters selected show no row; all four show "Spelling", and a pick in
  its flyout rewrites the word
- answer the keyboard, and Escape closes them writing nothing: Escape closes the menu with the bytes
  as they were; ArrowDown then Enter picks the second suggestion
- rewrite the word behind live mode's hidden markers: `**tset**` in live mode becomes `**test**`
- keep a CRLF document's line endings around the word: only the word's bytes change
- rewrite a word in a table cell: the cell's word is captured and rewritten in place

## The waves and the hover card

- a misspelled word gets a wave, a right one and code none, and the browser checker is off: two
  misspelled words in a paragraph show two waves and the same word in a code fence none; the
  paragraph carries `spellcheck="false"` while the plugin runs
- resting the pointer on the word opens its rows alone, and a pick rewrites it: the hover card shows
  the suggestions without the clipboard rows, and its pick rewrites the word (its 800 ms rest and
  300 ms grace are the hover unit's rows)
- the word being typed stays plain until the caret leaves it: the space after the word brings its
  wave
