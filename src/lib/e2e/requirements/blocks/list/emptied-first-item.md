# Feature: emptying the first item of a list right under a paragraph

A marker with nothing after it cannot interrupt a paragraph, so `para\n-\n` reloads as a heading. An emptied first item right under a paragraph takes a blank line above its list, the list's own separator, so the paragraph stays a paragraph.

## User interactions

- Load `para\n- x\n`, delete `x` with Backspace: the source is `para\n\n- \n` and reloads as a paragraph and a list; a typed character lands in the item
- After that Backspace, one undo gives back `para\n- x\n`
- Load `para\n- x\n`, replace `x` with nothing through the find bar: the source is `para\n\n- \n`, and the paragraph is not a heading

## Miss-analysis

- GH #438: the shape property skipped exactly this slot, and its harness rebuilt the list without the separator settle typing runs, so the find bar's replace, which rebuilt the same way, was never checked; convergence passed because the fold read the heading the bytes spelled.
