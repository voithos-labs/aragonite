# Feature: Mermaid broken-fence whole-block focus (the error card is still THE block)

A ` ```mermaid ` fence whose code the renderer rejects shows an error card instead of a diagram.
That card is a full whole-block focus target rather than a dead zone: every keyboard gesture the
rendered diagram supports works the same in the error state, and the ways into editing stay
reachable, since they are how the user fixes the broken source. The same holds for the loading
state and the state with no renderer, which declare the same behavior but are not driven
separately here, because no harness exists without an injected renderer.

Fixture (loaded per test): a paragraph `Above text`, one invalid ` ```mermaid ` fence
(`notadiagram broken`), and a paragraph `tail text`.

## Happy paths

- ArrowUp from `tail text` stops on the broken block and focuses it, with the `:focus-within`
  highlight as the visible ring; a second ArrowUp leaves for `Above text`
- Enter while the error card is focused inserts an empty paragraph below with the caret in it
- Alt+ArrowDown moves the broken block below its next sibling and keeps it focused, and
  Alt+ArrowUp moves it back

## User interactions

- Backspace at offset 0 of `tail text` focuses the broken block with the source unchanged; a
  second Backspace deletes it; one undo restores it byte for byte
- Clicking the error card focuses the block, and the click is handed on to the block's editing
  host, the same click-to-focus the rendered diagram has

## Error recovery

- The toolbar's Edit button opens the textarea holding the broken code; replacing it with valid
  code and pressing Ctrl+Enter commits, the diagram renders, and focus lands back on the block's
  editing host, since swapping the textarea for the render must not drop focus to the page
- Double-clicking the error card opens edit mode holding the broken source, the same
  double-click behavior the rendered diagram has
