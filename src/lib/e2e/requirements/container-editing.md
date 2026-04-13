# Feature: Container Block Editing

Editing inside blockquotes and lists: nested content, item creation, exit behavior.

## Happy paths
- blockquote content editable: click into blockquote, type text, source updates with > prefix
- list item content editable: click into list item, type text, source updates with marker prefix
- Enter in list item creates new item: pressing Enter at end of a list item adds a sibling item
- blockquote source round-trips: editing inside blockquote preserves > prefix structure

## Edge cases
- empty list item exit: Enter on an empty list item exits the list (creates paragraph after list)
- exit at first list item places cursor before list: Enter on empty first item creates paragraph before, not after, the remaining list (regression: caret teleported to end)
- blockquote double-Enter exit keeps caret visible: Enter to create empty line, Enter again exits blockquote with cursor in a usable block (regression: caret disappeared)
- nested list renders: a list with nested sub-items renders as a single top-level list block
- blockquote with multiple paragraphs: multi-paragraph blockquote renders and edits correctly
- editing preserves container raw: after typing in a list item, getSource() still has correct indentation
- ordered list numbering: new items in an ordered list get incrementing markers
- Backspace on empty non-first list item deletes the item: pressing Backspace at the start of an empty item (not the first) removes it and moves focus to end of previous item
- Blockquote first-child unwrap on Backspace: pressing Backspace at offset 0 of a blockquote's first child's first paragraph lifts that child out of the blockquote into the parent at the blockquote's position. If the blockquote becomes empty, it is deleted. Each press lifts exactly one structural level; nested blockquotes require multiple presses.
- Blockquote unwrap preserves multi-paragraph blockquotes: for a blockquote with multiple inner paragraphs, Backspace lifts only the first paragraph out; the remaining paragraphs stay inside the (shrunk) blockquote.
- Nested blockquote: Backspace at start of innermost content unwraps one level (inner blockquote dissolves, content stays inside the outer blockquote).
- Blockquote containing a list: Backspace at start of the list's first item runs U1 (list unwrap) against the inner list, producing a plain paragraph still wrapped by the blockquote.
- Blockquote unwrap does NOT auto-merge with the preceding block: Backspace at start of a blockquote that follows a paragraph produces two separate paragraphs, not a merged one.

## User interactions
- click into nested container then type: click a list item, focusBlockEnd, typeText, verify source
- Enter at end of list item creates new and cursor lands there: verify typing goes into the new item
- exit list then continue typing: after empty-item exit, typing goes into the new paragraph

## List indentation
- Tab nests item under previous sibling: pressing Tab on a non-first list item nests it as a sub-item of the previous sibling
- Tab on first item does nothing: pressing Tab on the first list item has no effect (no previous sibling to nest under)

## Nested lists
- Nested list items render as indented sub-lists
- Typing in a nested item preserves nesting structure
- Enter at end of nested item creates new sibling at same level
- Source output preserves nested indentation after editing
