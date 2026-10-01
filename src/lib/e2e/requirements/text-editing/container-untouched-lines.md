# Feature: an edit inside a quote or list leaves its other lines alone

Typing, Enter or Backspace inside a quote or a list item changes the lines it edits. Every other line of that container keeps the bytes the file had: a tab stays a tab, `>b` stays `>b`, and a lazy line (a paragraph's continuation written with no prefix at all) stays bare.

## Happy paths

- `> a\n>b\n`, click `a`, End, type `Q`: `> aQ\n>b\n`
- `- ab\n\n\tc\n`, Enter between `a` and `b`: the new item takes `b` and the `c` below it, and `c` keeps its tab (`- a\n- b\n\n\tc\n`)
- Both of the above in live mode, with the same bytes

## Edge cases

- `- a\nlazy\n`, click `a`, Home, type `# `: the heading takes the item and `lazy` stays bare, so the reload reads a list and a paragraph below it, and that's what the editor holds too (`- # a\nlazy\n`)

## Miss-analysis

- Every container rebuild respelled the whole container in its canonical form, and every container fixture was already written that way, so no spec ever watched an untouched line move.
