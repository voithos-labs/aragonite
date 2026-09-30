# Feature: Sticky Column, a trip through the host header

A host can put its own header inside the editor (the `header` snippet). Focus that moves there
leaves the blocks without leaving the editor, so the caret stops being the editor's own. The
column an Up/Down run held has to go with it, the same as when focus leaves the editor for good.

Run on `/test/host-theme`, the one route with a header holding buttons and plain text.

## Reset triggers

- ArrowDown twice from the end of the first paragraph, click the header's mode button, Tab back
  into the first block, ArrowDown: the caret lands near the column Tab left it at, not the one the
  run held.
  - Miss-analysis: the focusout that drops the caret memory counted the header as part of the
    editor, and no test ever left the blocks for the header and came back by keyboard.
- The same trip with a click on the header's plain text instead of a button: same landing.
