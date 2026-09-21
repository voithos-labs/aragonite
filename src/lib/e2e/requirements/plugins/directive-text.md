# Feature: inline directive widget at the text level, edited by showing its source

The `:` recognizer marks a `:name[label]{attrs}` span as a `directiveText` inline node, rendered
as a widget the caret cannot enter (`[data-inline-widget]`, `.directive-text-widget`,
`contenteditable` false) that carries its raw span in `data-source-*` and counts as 0 characters
in the offset traversal. Focusing the widget shows its source as editable text; blurring it or
pressing Enter commits the edit and re-renders, the same way inline math does. Showing the
source changes nothing in the tree: only a real edit and its commit change the source.

## Happy paths

- `see :abbr[HTML] here` renders `:abbr[HTML]` as one `.directive-text-widget`: `[data-inline-widget]` carries `data-source-start`/`-end` covering the raw span, and the paragraph round-trips byte for byte.

## User interactions

- ArrowRight to the left of the widget (Home, ArrowRight to its leading edge, one more to enter it): the source appears in place at the leading edge and the widget count drops to zero; a typed character lands before the directive source, and the source in the tree is unchanged.
- ArrowLeft to the right of the widget (End, ArrowLeft to its trailing edge, one more to enter it): the source appears at the trailing edge, and a typed character lands after the directive source.
- Backspace to the right of the widget: the source appears with the directive span fully intact, rather than the whole widget being deleted silently.
- ArrowLeft from the block below onto a block ending with the widget: the source appears at the trailing edge, the edge the move arrived at.
- Click the widget: its source appears as editable text and the widget count drops to zero; the source has not changed, since this only changes what is shown.
- Edit the shown source, then blur to another block: the widget re-forms, the source round-trips the edit byte for byte, and a single undo restores the source as it was before the edit.

## Edge cases

- Escape after editing the shown source: the edit is discarded and the original widget is rebuilt from the untouched raw text, so the source is unchanged.
- A `:abbr[HTML]{` part-way through typing briefly turns back into literal text until `}` closes it. That comes from the shared inline-widget code and is covered by the decline table in `text-recognizer.test.ts`, so it is not an e2e scenario here. It is written down so that this kind's appear-and-disappear behavior while typing, the same as inline math's, stays documented.
