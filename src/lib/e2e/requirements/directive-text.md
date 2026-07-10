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

- ArrowRight across the widget (atomic cursor contract): one press past the left edge selects the widget, the next steps over its trailing edge so a typed char lands immediately after the widget's source, not inside it.
- Keyboard-select the widget then Enter: the rendered atom is replaced by its editable source (widget count drops to zero) with the CST source unchanged.
- Click the widget: its source is revealed as editable text (widget count drops to zero); the source has not changed (view toggle only).
- Edit the revealed source then blur to a sibling block: the widget re-forms, the source round-trips the edit byte-for-byte, and a single undo restores the pre-edit source.

## Edge cases

- Escape after editing the revealed source: the edit is discarded and the original widget is rebuilt from the untouched raw — the source is unchanged.
- The trailing-brace revert (a `:abbr[HTML]{` mid-type transiently reverts the atom to literal text until `}` closes it) is inherited from the inline-widget primitive and unit-covered by the decline table in `text-recognizer.test.ts` — not an e2e scenario here. It is recorded so the reveal path's appear/disappear-across-input behavior (as with inline math) stays documented.
