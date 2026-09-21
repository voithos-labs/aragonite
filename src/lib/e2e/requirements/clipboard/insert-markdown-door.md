# Feature: insertMarkdown, the programmatic insertion door

`editor.insertMarkdown(md)` routes `md` through the paste pipeline at the current
caret or selection: the same transforms, the same strategy pick, the same
delete-selection-first rule, one undo entry. Every scenario below asserts what
pasting the same bytes at the same caret produces: the method must match paste,
and has no behavior of its own.

## Happy paths

- Table markdown inserted at the end of a paragraph: the paste splits structurally, a
  `table` block lands between the two halves, and the next keystroke appends inside the
  inserted table's last cell.
- A single-line snippet inserted mid-paragraph: the inline strategy splices the bytes at
  the caret offset, the block count is unchanged, and the caret sits after the inserted
  bytes.
- List items inserted with the caret inside a same-type list: the container-match strategy
  absorbs them as siblings of the target item, exactly as pasting them would.
- A table over a to-do's whole paragraph: the item gives its checkbox up with the paragraph,
  since a task marker stands in front of a paragraph and nothing else.
  - Miss-analysis: the task-marker rule was pinned on the routes a keystroke reaches, and the
    method's own cases all insert into plain prose, so the write the structural strategy makes
    for itself was the one route no test asked the question on.

## Edge cases

- A structural insertion at a collapsed caret: one undo restores the pre-insertion document
  and its block count, so the claim binds every strategy rather than the replace alone.
- A live cross-block selection: the range is deleted and the payload lands at the collapsed
  caret, and one undo restores both halves of the document.
- A selected inline widget in a paragraph holding no other text: the widget's bytes are
  replaced, the same branch a paste over it takes. The state is worth pinning because the
  browser routes its clipboard events to `<body>` there while the block keeps DOM focus,
  which is what the method resolves from.
- A registered paste transform rewrites the inserted text before it is parsed, so the
  bytes this method inserts reach the tree transformed.
- a focused table cell takes the call: the insertion lands in the cell's bytes through the published ref, matching a paste there
