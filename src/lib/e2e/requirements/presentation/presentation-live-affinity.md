# Feature: live-mode caret edges (byte-honesty against hidden markers)

Live hides every Markdown marker and reveals none, so a focused block's own
structural prefix (`## `, a code fence) and its inline construct markers (`**`,
`[ref]`) sit beside the caret unpainted. The contract: the caret is a raw offset,
no caret ever reports from inside a hidden run, and a block's exits and its
destructive keys read the block's CONTENT bounds rather than raw 0 / raw length.
Driven on `/test/editor` via `?presentationMode=live`; offsets are read back
through the `window.__test` selection bridge, which is the only oracle for where
Chromium actually left the caret.

## Happy paths

- `Home` in a heading lands at the content start, past the unpainted `## `, and
  the bridge reports that offset — not raw 0
- `Home` in a paragraph that opens with `**bold**` lands after the unpainted `**`
- `End` in a paragraph lands at the block's last raw offset
- a rightward arrow walk across `Some **bold** text` reports no offset that sits
  strictly inside either marker run, and reaches the block end
- `ArrowRight` at the block end still exits into the next block

## Edge cases

- `ArrowLeft` arriving at a construct's trailing edge crosses the whole hidden
  run in ONE press and stops at the construct's content edge (`bold`'s last
  byte), never at an offset inside the run
- `Backspace` at a heading's content start is SWALLOWED: the block's bytes are
  unchanged, no merge fires, and the caret stays put — native backspace would eat
  a hidden `#` or the marker's space and reparse the block into a paragraph
  rendering the leftovers
- `Backspace` at a paragraph's start still merges with the previous block: the
  swallow claims only a caret sitting against a hidden structural prefix
- `ArrowUp` / `ArrowDown` on the first / last visual line still exit the block,
  landing in the neighbour at a reachable offset
- a caret entering a fenced code block by block exit, by `Home`, or by click sits
  in the code BODY: typed bytes land there and both fence lines survive verbatim
- a table cell holding `[text][ref]`: `Home` and `End` land on the link text's
  own bytes, and typing lands inside `text` with the hidden `[ref]` untouched

## User interactions

- Real keyboard and real clicks only: programmatic caret placement would bypass
  the landing seam and the block-edge dispatch this contract rests on
- Offsets are asserted from the selection bridge, never from a DOM read — the
  browser decides which DOM position a keystroke leaves behind, and the bridge is
  what canonicalizes it

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the
  shared e2e fixture)
