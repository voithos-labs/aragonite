# Feature: text-tier directive inline widget — source-reveal editing

The `:` recognizer stamps a `:name[label]{attrs}` span as a `directiveText` inline
node, rendered as an atomic `[data-inline-widget]` island (`.directive-text-widget`,
contenteditable false) that carries its raw span via `data-source-*` and counts 0
chars in the offset walk. Focusing the widget reveals its editable source; blur or
Enter commits the edit and re-renders, mirroring the inline-math reveal primitive.
The reveal is a CST-free view toggle — only a real edit + commit mutates the source.

## Happy paths

- `see :abbr[HTML] here` renders `:abbr[HTML]` as one `.directive-text-widget` atom: `[data-inline-widget]` carries `data-source-start`/`-end` = the raw span, and the paragraph round-trips byte-for-byte.

## User interactions

- ArrowRight left of the widget (Home, ArrowRight to the leading edge, one more to enter): the source reveals in place at the leading edge (widget count drops to zero); a typed char lands before the directive source, and the CST source is unchanged.
- ArrowLeft right of the widget (End, ArrowLeft to the trailing edge, one more to enter): the source reveals at the trailing edge; a typed char lands after the directive source.
- Backspace right of the widget: the source reveals with the directive span fully intact — NOT a silent whole-widget delete.
- Cross-block ArrowLeft from the block below onto a block ending with the widget: the source reveals at the trailing edge (the near edge the move arrived at).
- Click the widget: its source is revealed as editable text (widget count drops to zero); the source has not changed (view toggle only).
- Edit the revealed source then blur to a sibling block: the widget re-forms, the source round-trips the edit byte-for-byte, and a single undo restores the pre-edit source.

## Edge cases

- Escape after editing the revealed source: the edit is discarded and the original widget is rebuilt from the untouched raw — the source is unchanged.
- The trailing-brace revert (a `:abbr[HTML]{` mid-type transiently reverts the atom to literal text until `}` closes it) is inherited from the inline-widget primitive and unit-covered by the decline table in `text-recognizer.test.ts` — not an e2e scenario here. It is recorded so the reveal path's appear/disappear-across-input behavior (as with inline math) stays documented.
