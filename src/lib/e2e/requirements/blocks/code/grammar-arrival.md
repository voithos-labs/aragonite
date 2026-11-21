# Feature: a grammar that arrives after the fence painted

With the highlight package listed, a fence in a language outside its eager set paints plain at
once and fetches its grammar; the tokens paint when it arrives. The text never changes, so nothing
the user is doing may notice: the caret, the selection and the block's height stay where they were.

## Happy paths

- a grammar arriving between two typed letters: the second letter lands after the first, the
  caret's byte is right after it, and the block's height is unchanged
- the tokens paint once the grammar arrives
- the tokens take the editor theme's colours with no stylesheet from the package

## Edge cases

- a grammar arriving mid-composition: the composed text stays as it is until the commit, the commit
  lands it, the block then paints tokens, and the height is unchanged
- a grammar arriving during a drag selection: the selection the drag ends with covers the text the
  pointer moved over, and the height is unchanged
- a grammar arriving while a block math source is selected whole (Ctrl+A, `?seed=mathblock-highlight`):
  the selection holds, so Ctrl+X cuts the whole source

## Error cases

- a grammar whose chunk fails to load: the fence stays plain, one `error` event names the
  highlight plugin, and the chunk is asked for once

## Miss-analysis

- Nothing could have caught this: grammars loaded eagerly before the highlight package, so no paint
  ever arrived late.
- The select-all row: the arrival rows ran on the code block alone, whose repaint kept a range; a
  source view's repaint went through the native-edit path, which keeps only a caret.
