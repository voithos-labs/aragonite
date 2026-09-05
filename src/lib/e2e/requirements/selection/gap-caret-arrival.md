# Feature: the caret arrives in the gap between two blocks

Some boundaries no block's own editing surface can reach: a table directly above a
code fence leaves nowhere to put a paragraph between them. The gap caret is a third
selection mode that parks there. A kind declares which of its edges may hold one, so
eligibility is a descriptor fact, never a kind-name check.

This file covers ARRIVAL at ROOT boundaries and the pure exits. Nested and windowed
arrival is `gap-caret-arrival-scopes.md`; minting and undo are `gap-caret-editing.md`;
paint and the non-mint ways out are `gap-caret-surface.md`.

## Happy paths

- ArrowDown out of the last table cell, with a fence below: the caret parks at the
  boundary (root index 2) and DOM focus moves into the gap's proxy. A second ArrowDown
  enters the fence and the gap ends.
- ArrowUp from the fence's first line, with a table above: the same boundary. A second
  ArrowUp lands back in the table's last cell.
- Backspace at offset 0 of a fence whose previous sibling is a table: the caret parks at
  the boundary instead of entering the table.
- Delete at the closer boundary of a fence whose next sibling is a table: the caret parks
  at the boundary instead of entering the table.
- A click in the editor's leading padding, above a document that starts with a table, parks
  the caret at the document's start boundary.
- Escape leaves the gap for the block above; the four exit keys leave for the block the
  direction names.
- At the document's start boundary a backward exit keeps the gap — there is no block above
  to land in — while Escape takes the forward arm into the first block.

## Edge cases

- Backspace at offset 0 of a fence whose previous sibling is a PARAGRAPH is unchanged:
  the boundary is ineligible, so focus enters the paragraph as it always did.
- A click in the leading padding above a document that starts with a paragraph is
  unchanged: nearest-band landing.
- Reading mode never parks a gap. The click is what this file pins; reading mode focuses no
  block, so the traversal arm has no gesture to drive and is unit-pinned instead.

## User interactions

- Arrow keys, Backspace, Delete, Escape at real block boundaries — every arrival is a
  keystroke or a mouse click, never a programmatic selection write.
- With a live cross-block range, a gap-landing click ends the range and parks the caret
  in one gesture (G2.12).

## Known v1 narrowings

- The click route lands ROOT-level gaps only. The band walk is a flat query over
  `[data-block-path]`, and nested bands nest inside their container's; arrows and restore
  reach nested gaps.
- Root block bands tile flush (0.0000px across every built-in kind pair, both palettes,
  zoom 0.9-1.75), so the only band-less strip a click reaches today is the leading padding.
  A host stylesheet that gives `.block-host` a margin does open the strip, which is what
  the between-two-bands rule is for.
- Entering a container from outside lands its deepest leaf as before and does not visit a
  nested scope-end gap; only a move that starts inside the scope sees it.
- Strip containers (blockquote, list, githubAlert) declare no edges — their unwrap/exit
  gestures own insertion. Opaque containers (callouts, details, the generic directive)
  declare both (#93); those boundaries are pinned in
  `plugins/gap-caret-opaque-containers.md`.
- The root's trailing boundary is deliberately excluded: the move-past-end append owns it.
- The ArrowUp-from-the-fence-body scenario no longer pins a press COUNT. It walks upward until
  the gap caret appears, because how many visual lines a fence opener occupies is an engine fact
  and the same fixture reaches the boundary a press sooner under WebKit than under Chromium. What
  the walk drops is the Chromium claim that the opener holds its own visual line; the sibling
  claim for the CLOSER still carries it, at `blocks/code/editing-block-exit.spec.ts` ('ArrowDown
  past the closer line exits to next block') and `blocks/code/editing-undo.spec.ts` ('type
  multi-line code then navigate out via ArrowDown'), both Chromium-only. A count assertion here
  would need a `browserName` branch, which is exactly what the shared-arm harness design forbids.

## Miss analysis

No test could have caught this: the gap caret is new behavior, not a regression. The
boundary class it serves (a caret with nowhere to live between two whole-block kinds) was
unreachable by any gesture, so no existing spec could observe its absence.
