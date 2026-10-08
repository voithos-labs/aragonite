# Feature: insertMarkdown, the programmatic insertion entry point

`editor.insertMarkdown(md)` routes `md` through the paste pipeline at the current
caret or selection: the same transforms, the same strategy pick, the same
delete-selection-first rule, one undo entry. Every scenario below asserts what
pasting the same bytes at the same caret produces: the method must match paste,
and has no behavior of its own.

## Happy paths

- Table markdown inserted at the end of a paragraph: the paste splits structurally, a
  `table` block lands between the two halves, and the next keystroke appends inside the
  inserted table's last cell.
- A table over a to-do's whole paragraph: the item gives its checkbox up with the paragraph,
  since a task marker stands in front of a paragraph and nothing else.
  - Miss-analysis: the task-marker rule was pinned on the routes a keystroke reaches, and the
    method's own cases all insert into plain prose, so the write the structural strategy makes
    for itself was the one route no test asked the question on.

## Edge cases

- A selected inline widget in a paragraph holding no other text: the widget's bytes are
  replaced, the same branch a paste over it takes. The state is worth pinning because the
  browser routes its clipboard events to `<body>` there while the block keeps DOM focus,
  which is what the method resolves from.
- a focused table cell takes the call: the insertion lands in the cell's bytes through the published ref, matching a paste there

## Held by another spec

A single-line snippet inserted mid-paragraph splices inline at the caret and leaves the block count
alone. The paste at a caret in `e2e/tests/clipboard/single-block/basics.spec.ts` takes the same
route and checks that.

## Pinned below the browser

`insertMarkdown` and a paste share one route, so these ran as rows here and moved to the
tests of that route (`test/blocks/editable-surface-clipboard.test.ts` holds the order of its steps
and the payload it hands the cross-block branch):

- List items inserted inside a same-type list absorb as siblings of the target item
  (`test/tree-operations/paste/list-absorb-rows.test.ts`).
- A structural insertion is one undo entry (`test/tree-operations/paste/paste-undo-caret.test.ts`).
- A live cross-block selection is replaced by the payload, and one undo restores both halves
  (`test/selection/cross-block/cross-block-undo-entry.test.ts`).
- A registered paste transform rewrites the inserted text before it is parsed
  (`test/tree-operations/paste/dispatch-transforms.test.ts`).
