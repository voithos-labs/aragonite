# Feature: Tab and Shift+Tab over a selection

Over a selection that spans blocks, Tab and Shift+Tab are indentation keys. Every list item the
selection reaches into nests one level (Tab) or lifts one level (Shift+Tab), the code lines it
covers get a tab added or taken off, and prose and tables stay exactly as they are. Nothing is ever
deleted. The selection stays put afterwards, so you can keep pressing, and each press is one undo
entry.

An item that can't move stays where it is while the rest still move: the first item of a list has
nothing above it to nest under, and a top-level item has nowhere to lift to (it doesn't turn into a
paragraph). An item whose parent moved went along with it, so it doesn't move a second time.
Tab over prose or a table is pinned in `clipboard/cross-block-destructive-keys.md`, next to the
keys that do delete.

## Happy paths

- Shift+Tab over a line and the top-level list right below it (drawn from the end of the last item
  up to the start of the line) leaves the document alone and keeps the selection
  - Miss-analysis: Tab was a "delete the range, then press the key" command, and every test of it
    drew prose or a table, so nothing ever pressed Shift+Tab over list items and watched the
    section vanish
- Tab over two sibling items nests both under the item above them, and one Ctrl+Z puts both back
- the selection is still there after Tab, so a second Tab nests the last item one level deeper
- Shift+Tab over two items inside a nested list lifts each of them once, not the item holding the
  caret twice
  - Miss-analysis: the list item's own Tab handler ran on the same key as the selection's, so a
    selection inside a nested list moved only the item holding the caret

## Edge cases

- Tab over a selection from the middle of a code block down into the paragraph below adds a tab to
  each code line the selection covers, and the paragraph is left alone
