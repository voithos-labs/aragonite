# Feature: Plugin Inline Math — Select → Reveal-Source Editing

Inline `$…$` math renders as an atomic KaTeX widget. Focusing it (a click on the
widget, or a horizontal caret entry against its edge) reveals the editable `$…$`
source in place — the caret never parks in an invisible widget-selected state. The
full caret-entry gesture matrix (arrow / backspace / delete, both edges, within-block
and cross-block, plus the image-selects contrast) lives in `latex-inline-caret-entry.md`. The
edit is ephemeral DOM — no per-keystroke CST commit (design axis A2, "re-render on
commit, not keystroke") — and re-renders on commit (blur, or the caret walking out
of the source). Enter is NOT a commit gesture: it is the block's split key, and the
command seam folds the reveal before splitting (`latex-inline-reveal-commands.md`).
Escape discards
the edit and restores the rendered widget. The caret lands in the source across the
reveal swap and at the math's trailing edge across the commit re-render (flagship
axis A1). IME composition during the source edit is the spec's named highest-risk
edge, driven through the suite's shared CDP driver so the events are the browser's own.

Seed (`?seed=math`): `Before $x^2$ after` in block [0], a `Next` paragraph in [1]
as a blur target. Seed (`?seed=math-multiline`): a two-visual-line paragraph with the
math on line 1 and column-aligned text on line 2, for the reveal hit-test.

## Happy paths

- click the rendered math: the `$…$` source appears in place, the KaTeX widget is
  gone, and the serialized source is unchanged — reveal is a view toggle, not an edit
- keyboard caret-entry from the left (Home, ArrowRight to the widget's leading edge,
  one more to enter it): the source reveals in place at the leading edge — no
  invisible select-then-Enter step; a typed char lands before the opening `$`
- edit the revealed source and walk the caret out of it (End): KaTeX re-renders and
  the edited `$…$` bytes are in the source (round-trip stable)

## Edge cases

- the reveal caret lands inside the source: a character typed right after reveal
  appears within the `$…$`, not at a block edge
- after commit the caret sits at the math's trailing edge: a character typed after
  the commit appears immediately after the re-rendered math — the escaping caret's
  own position does not survive the fold, the widget's trailing edge does
- Escape after editing: the rendered widget returns carrying the ORIGINAL source and
  the serialized source is byte-identical to the seed — the edit is discarded
- click on real text on another visual line that column-aligns with the widget: the
  caret lands in that text and the widget stays rendered — the reveal hit-test is
  point-in-rect (X and Y), not X-only
- after a blur-away commit (focus moved to another block), the selection stays in the
  block that took focus — the just-blurred math block does not yank the caret back
- a cross-block selection swept down from the reveal caret (its anchor staying inside
  the revealed source) survives a blur without folding: the commit bails on the
  cross-block selection instead of folding the island out from under the anchor. The
  source block is one visual line, so the sweep is two Shift+ArrowDown presses — the
  first extends to the line end within the block (a shift-extension keeps the source
  revealed), the second crosses the boundary

## User interactions

- real mouse click on the widget; real Home / End / ArrowRight / Escape / typing —
  no programmatic selection or caret placement
- real CDP IME composition (genuine compositionstart → update → compositionend) into
  the revealed source commits nothing per keystroke; the composed math commits only
  when focus leaves the block

## Error cases

- the `[invariant:…]` console watcher stays silent across reveal, edit, commit,
  cancel, and the IME path
