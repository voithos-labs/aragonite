# Feature: paste under the WebKit clipboard arm

The lane's clipboard seam, exercised end to end. WebKit rejects the clipboard permission grants at
context creation, and its `writeText` resolves into a clipboard the synthetic paste chord cannot
see, so the harness seeds and pastes through a dispatched `ClipboardEvent` carrying a
`DataTransfer`. The helper signatures are the ones every Chromium spec already calls, so what
these scenarios prove is that the seam DELIVERS: the editor's paste handlers read `text/plain` off
the event whichever engine fired it, and its copy handlers write bytes the same seam can read back.

What they do not prove, both pinned in the Chromium clipboard suite: the chord, since a dispatched
paste event skips WebKit's own Ctrl/Cmd+V key handling; and the editor root's fallback arm, since
the dispatch targets `document.activeElement`, which makes `landedNowhere` false and leaves that
arm (`components/editor-root-clipboard.ts`) unreachable through this lane.

## Happy paths

- Paste plain text at a caret inside a paragraph: the bytes land at the caret, the text on both
  sides survives, and the document gains no block.
- Paste a two-paragraph payload at the end of a paragraph: the document gains the blocks the
  payload carries rather than absorbing it as one line.
- Paste into a list item: the payload lands inside the item and the list keeps its marker.

## Edge cases

- Copy then paste in one session: the arm records what the editor wrote into the copy event and
  hands those bytes back to the paste, so a cross-block copy reproduces its text at a caret
  elsewhere and the copied blocks stay where they were.

## Error cases

- Zero `[aragonite:…]` sentinel fires across every scenario — enforced by the shared fixture
  watcher, which fails any spec whose page emits one.
