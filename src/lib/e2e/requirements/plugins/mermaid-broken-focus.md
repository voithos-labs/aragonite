# Feature: Mermaid broken-fence whole-block focus (the error card is still THE block)

A ` ```mermaid ` fence whose code the engine rejects renders an error card instead of a
viewport. That card is a full whole-block focus surface, not a dead zone: every keyboard
affordance the rendered diagram carries works identically in the error state, and the edit
affordances stay reachable — they are the user's recovery path to fix the broken source.
The same holds for the loading and no-renderer static states (same focus surface, not
separately driven here — no harness exists without an injected renderer).

Fixture (loaded per test): a paragraph `Above text`, one invalid ` ```mermaid ` fence
(`notadiagram broken`), a paragraph `tail text`.

## Happy paths

- ArrowUp from `tail text` stops on the broken block and focuses its error surface (the
  `:focus-within` highlight is the visible ring); a second ArrowUp exits to `Above text`
- Enter while the error card is focused inserts an empty paragraph below with the caret in it
- Alt+ArrowDown reorders the broken block below its next sibling and keeps it focused;
  Alt+ArrowUp moves it back

## User interactions

- Backspace at offset 0 of `tail text` focuses the broken block with the source
  byte-unchanged; a second Backspace deletes it; one undo restores it byte-exactly
- Clicking the error card focuses it (same click-to-focus as the rendered viewport)

## Error recovery

- The toolbar Edit button opens the textarea seeded with the broken code; replacing it with
  valid code and pressing Ctrl+Enter commits, the diagram renders, and focus lands on the
  new viewport (the focus surface swap must not drop focus to the page)
- Double-clicking the error card opens edit mode seeded with the broken source (dblclick
  parity with the rendered viewport)
