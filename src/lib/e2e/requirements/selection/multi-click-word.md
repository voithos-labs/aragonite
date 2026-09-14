# Feature: the word rung of the click ladder

Double-click a word and you get the word. The editor works that out itself
(`selection/multi-click.ts`) instead of letting the browser do it, because the browser's word
rule depends on the platform (Windows grabs the space after the word), its walk wanders into
whatever non-editable island sits next door (a formula, an entity glyph), and it paints its
range before anything could correct it. Here the trimmed word is the first range painted,
markers never count as part of a word, and an island beside a word is never taken with it.
A double-click on an inline widget is the widget's own gesture (`plugins/latex-inline.md`),
not the ladder's.

## Happy paths

- double-click a word before an inline formula, in source and live mode: the word alone,
  with the rendered formula left outside the range
  - Miss-analysis: every double-click pin sat on a widget (a footnote's, a formula's own
    token) or in the trim's jsdom unit; none double-clicked plain text beside an island, and
    the harness's default page mounts no math plugin, so a word beside a formula was never
    on screen in a spec
- double-click a word before an entity glyph: the word alone, no trailing space
- double-click a word inside `_ital_` in live mode: `ital`, never the hidden markers
- double-click a word in a table cell: the word alone
- double-click a word in a code block's body: the word alone
- double-click past the end of a line, on no glyph: the line's last word

## User interactions

- double-click a word and type: the word is replaced, the rest of the line isn't touched
