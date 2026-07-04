# Feature: Extending a selection to an off-window endpoint

In a long windowed document the last block may not be mounted at all. A
select-to-end shortcut must still reach it: the endpoint has to mount, scroll
into view, and behave like any other selection endpoint afterwards.

## User interactions

- From the first block of a long document, Ctrl/Cmd+Shift+End extends a
  cross-block selection to the unmounted last block: the endpoint mounts and
  scrolls into view, a following unshifted arrow key collapses the selection
  normally, and no page errors fire.
