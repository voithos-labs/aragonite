# Feature: the word level of the click order

Double-click a word and you get the word. The editor works that out itself
(`selection/multi-click.ts`) instead of letting the browser do it, because the browser's word
rule depends on the platform (Windows grabs the space after the word), its traversal wanders
into whatever non-editable widget sits beside it (a formula, an entity glyph), and it paints
its range before anything could correct it. The word is read off the text the word delete
reads, as the screen shows it: a hidden marker isn't there, so letters on both sides of one are
one word, and a widget is a character of its own, so it never joins the word beside it. The
two share word boundaries; the word delete adds its own reach (the spaces before the word).
A double-click on an inline widget is the widget's own gesture (`plugins/latex-inline.md`),
not this handler's.

## Happy paths

Each row on words also checks the word delete: Ctrl+Backspace at the word's end leaves the
document a double-click and Backspace leaves.

- double-click `b` in live `a**b**c`: `abc`, the hidden markers inside it included, on every
  engine; the same inside `q a**b**c z`, in a list item, behind a heading's hidden `# `, and
  after the `[^n]: ` label a footnote definition draws at its line's start
  - Miss-analysis: every live row put spaces around the hidden markers (`some _ital_ words`),
    where blanking markers to spaces and leaving them out read the same; no row had letters
    touching a hidden marker, the one shape where they differ
- double-click a word inside `_ital_` in live mode: `ital`, the hidden markers outside it
- double-click a word inside `_ital_` in source mode: `_ital_`, since the underscores are on
  screen and `_` is a word character, as in a code editor
- double-click a `snake_case` identifier in source mode: the whole identifier
- double-click `b` in source `a**b**c`: `b`, since shown asterisks split words
- double-click the word on either side of an entity, a formula or a picture touching it, in
  source and live mode: the word alone, with the widget left outside the range
  - Miss-analysis: every double-click test sat on a widget (a footnote's, a formula's own
    token) or in the trim's jsdom unit; none double-clicked plain text beside a widget, and
    the harness's default page mounts no math plugin, so a word beside a formula was never
    on screen in a spec
- double-click a word before an entity glyph: the word alone, no trailing space
- double-click a word in a table cell: the word alone
- double-click a word in a code block's body: the word alone
- double-click past the end of a line, on no glyph: the line's last word

## User interactions

- double-click a word in live mode where Ctrl+Shift+Left already agrees on every engine (the
  hidden-marker rows): Ctrl+Shift+Left from the word's end and Backspace leave the same document
- double-click `b` in live `a**b**c d**e**f` and drag to `e`: the range grows a word at a time,
  over the hidden markers, to the whole line
- double-click a word and type: the word is replaced, the rest of the line isn't touched
