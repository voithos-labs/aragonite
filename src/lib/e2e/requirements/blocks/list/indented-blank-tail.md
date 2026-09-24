# Feature: a list item whose body ends in an empty paragraph

## User interactions

- Type one character into the first paragraph of `- a\n\n  \n\n- c\n`: only the typed byte
  changes, the separator line stays bare and the empty paragraph's line keeps its indent, and
  the source reloads as the tree the editor holds
  - Miss-analysis: the tail-blank tests blanked a block and checked the reload, and none typed
    into a loaded body with a bare separator and asked for the bytes left alone
- The same keystroke in a nested item (`- a\n  - b\n\n    \n\n- c\n`): only the typed byte
  changes
- Empty the last paragraph of an item with Backspace, type a character, then undo twice: every
  step reloads as the tree the editor holds, and the second undo gives back the loaded source
