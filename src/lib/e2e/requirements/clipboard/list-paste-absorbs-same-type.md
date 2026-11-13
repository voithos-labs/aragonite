# Clipboard: a same-type list pasted into a list item

A list of the caret's list's type pasted at an item's text joins its first item into the caret's line and lands the rest as items of the caret's list, numbered on. The end of the text is the mid-text rule with nothing after the caret, as it is for paragraphs. A clipboard's last line ending opens the next item, as Enter does. The other-type list is `list-paste-mismatched-breaks-out`.

## Happy paths

- An ordered list pasted at the end of an ordered item: `1. alpha‸` + `1. x\n2. y` is `1. alphax\n2. y\n3. beta`.
- With the clipboard's last line ending: `1. alphax\n2. y\n3. \n4. beta`, the caret in item 3, and a letter typed next goes in it.
- A paste into an empty item lands the items as items: `1. alpha\n2. ‸\n3. beta` + `1. x\n2. y` is `1. alpha\n2. x\n3. y\n4. beta`.

## User interactions

- To add the items below an item instead of joining it, press Enter first, then paste.

## Edge cases

- Pasted mid-item, the last pasted item takes the rest of the line, and the drawn markers match the source's after the renumber.

## Pinned below the browser

- The core's rows for a list pasted into a list, its C8 and M rows: `test/range-edit/named-rows.test.ts`.
- The last line ending against Enter, over bullets, numbers, to-dos, a nested item, an item's second paragraph, an item in a quote and CRLF: `test/range-edit/paste-ending-enter.test.ts`.

Miss-analysis: every row pasted a list without its last line ending, or into a paragraph, so none asked what the ending does in an item.
