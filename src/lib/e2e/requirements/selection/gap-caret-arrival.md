# Feature: the caret arrives in the gap between two blocks

Some boundaries no block's own editable area can reach: a table directly above a
code fence leaves nowhere to put a paragraph between them. The gap caret is a third
selection mode that rests there. A kind declares which of its edges may hold one, so
eligibility comes from the kind's descriptor, never from a check on its name.

This file covers arrival at root boundaries and the exits that change nothing. Nested
and windowed arrival is in `gap-caret-arrival-scopes.md`; creating a paragraph and
undoing it are in `gap-caret-editing.md`; painting and the ways out that create nothing
are in `gap-caret-surface.md`.

## Happy paths

- ArrowDown out of the last table cell, with a fence below: the caret stops at the
  boundary (root index 2) and DOM focus moves into the gap's proxy element. A second
  ArrowDown enters the fence and the gap ends.
- ArrowUp from the fence's first line, with a table above: the same boundary. A second
  ArrowUp lands back in the table's last cell.
- Backspace at offset 0 of a fence whose previous sibling is a table: the caret stops at
  the boundary instead of entering the table.
- Delete at the closer boundary of a fence whose next sibling is a table: the caret stops
  at the boundary instead of entering the table.
- A click in the editor's leading padding, above a document that starts with a table, puts
  the caret at the document's start boundary.
- Escape leaves the gap for the block above; the four exit keys leave for the block the
  direction names.
- At the document's start boundary a backward exit keeps the gap, since there is no block
  above to land in, while Escape moves forward into the first block.

## Edge cases

- Backspace at offset 0 of a fence whose previous sibling is a paragraph is unchanged:
  the boundary is ineligible, so focus enters the paragraph.
- A click in the leading padding above a document that starts with a paragraph is
  unchanged: it lands on the nearest strip as usual.
- Reading mode never rests in a gap. The click is what this file pins; reading mode focuses
  no block, so the arrow-key branch has no gesture to drive and is pinned by a unit test
  instead.

## User interactions

- Arrow keys, Backspace, Delete, Escape at real block boundaries: every arrival is a
  keystroke or a mouse click, never a programmatic selection write.
- With a live cross-block range, a gap-landing click ends the range and puts the caret at
  the boundary in one gesture (G2.12).

## Known v1 narrowings

- The click route lands root-level gaps only. The walk over the strips is a flat query over
  `[data-block-path]`, and a nested block's strip sits inside its container's; arrows and
  restore reach nested gaps.
- Root blocks' strips tile flush (0.0000px across every built-in kind pair, both palettes,
  zoom 0.9-1.75), so the only space between strips a click reaches today is the leading
  padding. A host stylesheet that gives `.block-host` a margin does open one, which is what
  the between-two-strips rule is for.
- Entering a container from outside lands on its deepest leaf and does not visit a gap at
  the end of the nested child list; only a move that starts inside that child list sees it.
- Strip containers (blockquote, list, `githubAlert`) declare no edges, because their unwrap
  and exit gestures own insertion. Opaque containers (callouts, details, the generic
  directive) declare both (#93); those boundaries are pinned in
  `plugins/gap-caret-opaque-containers.md`.
- The root's trailing boundary is deliberately excluded: the move-past-end append owns it.
- The ArrowUp-from-the-fence-body scenario pins no press count. It walks upward until
  the gap caret appears, because how many visual lines a fence opener occupies is up to the
  browser, and the same fixture reaches the boundary one press sooner under WebKit than under
  Chromium. The walk gives up the Chromium claim that the opener holds its own visual line;
  the matching claim for the closer still holds it, at `blocks/code/editing-block-exit.spec.ts`
  ('ArrowDown past the closer line exits to next block') and `blocks/code/editing-undo.spec.ts`
  ('type multi-line code then navigate out via ArrowDown'), both Chromium-only. A count
  assertion here would need a `browserName` branch, which the shared harness design forbids.

## Miss analysis

No test could have caught this: the gap caret is new behavior, not a regression. The
boundary class it serves (a caret with nowhere to live between two whole-block kinds) was
unreachable by any gesture, so no existing spec could observe its absence.
