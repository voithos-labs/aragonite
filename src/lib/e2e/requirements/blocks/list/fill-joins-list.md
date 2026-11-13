# Feature: a to-do filled beside a to-do list joins it

A new line made right above or below a to-do list, then filled with a to-do, becomes an item of that list: the blank line that kept the line apart goes, a reload reads one list with even spacing between its items, and the key after the fill lands in the new item, in source and live mode. Undo walks back through the same entries the gesture made, and the entry that turned the line into a list brings the blank line back. The unit suite `test/tree-operations/list-fill-join.test.ts` holds the rows about which pairs count as the same list.

## Happy paths

- Enter at the end of `intro` over a to-do list, then `- [ ] start` typed key by key: the bytes read `intro`, a blank line, then one list starting with `- [ ] start` (regression, GH #696: the new to-do stood as its own list with a blank line before the old one; miss-analysis: the fill rows only asked whether the bytes reload as the tree, and two lists parted by a blank line do, so nothing asked whether they should have been one)
- Enter at the start of `after` under a to-do list, ArrowUp onto the new line, then `- [ ] start` typed: the new to-do is the list's last item and the key after it lands there

## User interactions

- The slash menu's To-do list row picked on a new line over the list: the row's `- [ ] ` joins the list and the typed `start` lands in the new item
- `- [ ] start` and its line ending pasted on a new line over the list: the pasted to-do joins the list, and the line ending opens no empty to-do, since the new line was no list item
- Right-click `intro`, Insert block, To-do list, with the list one blank line below: the inserted to-do joins the list

## Edge cases

- The same line typed under a 150-item to-do list, too long to draw whole: it joins as the last item and the key after it lands there
- Each gesture, reloaded from its saved bytes: one list block, and the new item sits as far from the next as the next sits from the one after
- One Ctrl+Z after typing the to-do keeps the joined `- ` item; the next gives back the blank line and the empty line, two blocks again
- One Ctrl+Z after the slash pick keeps the joined `- [ ] `; the next gives back the `/todo` line with its blank line
- One Ctrl+Z after the paste gives back the empty line and its blank line
- One Ctrl+Z after Insert block's typing keeps the joined `- [ ] `; the next takes the inserted to-do away, leaving `intro` and the list as they were
