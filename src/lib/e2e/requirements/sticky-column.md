# Sticky Column

Cross-block caret column memory for vertical arrow navigation. Vertical arrows capture the cursor's editor-relative pixel X at the first press after a reset and preserve it across multiple presses, so navigating through short intermediate lines does not collapse the cursor's horizontal intent. Within a single block, the browser's native sticky column handles the cursor; the editor only layers on top at block boundaries where the native sticky resets.

## Capture

- A sticky column value is captured on the first vertical arrow press after a reset.
- Capture is idempotent on the same press — repeated vertical arrows reuse the captured value rather than overwriting it.
- The captured value is editor-relative (scroll-invariant).

## Reset triggers

Any user action other than plain or shifted vertical arrows resets sticky column:

- Typing a character
- Click / pointer down
- Horizontal arrow keys (ArrowLeft / ArrowRight)
- Home / End
- Structural operations (split via Enter, merge via Backspace, indent/unindent)
- Undo / redo
- Editor blur (focusout to outside the editor)
- Tab visibility changes (document becomes hidden)

## Preserve triggers

A short list of actions specifically does NOT reset the sticky column:

- Plain vertical arrows (ArrowUp / ArrowDown)
- Shifted vertical arrows (Shift+ArrowUp / Shift+ArrowDown) for extending selection
- Composition events (IME composition start/end)

## Cross-block behavior

When a vertical arrow crosses a block boundary, the target block receives the sticky column X and should land the cursor at the offset nearest that X on its first (from-above) or last (from-below) visual line.

- **Editable prose blocks** participate fully: they measure pixel X via `focusAtColumn` and land the cursor at the nearest offset.
- **Transparent blocks** (thematic break): pass the sticky value through without capturing or resetting. The caret traverses the block as a unit; the next cross-block move continues with the existing column value.
- **Opaque blocks** (code block): reset on any interaction inside. The textarea surface has no standard pixel-X API, so entry from above lands at start-of-block and entry from below lands at end-of-block. Any keystroke inside resets the sticky column.

## Container traversal

The sticky column survives entering and exiting containers (blockquote, list, nested list). A cross-container move from outside into the first or last prose leaf of a container preserves the column; an inner vertical move between siblings inside a container likewise preserves it.

## Rapid navigation timing

Rapid successive vertical arrow presses across multiple blocks must all consult the same captured column value — no race between the DOM focus flush and the next keydown should cause the sticky state to reset mid-sequence. The `isAtFirstVisualLine` / `isAtLastVisualLine` geometry checks must tolerate back-to-back keypresses without leaking intermediate layout states.

## Edge cases

- Blocks whose first or last child is a dimmed marker span (heading `## `, code span markers): the visual-line geometry must walk past the marker to the real text node so sticky-column measurement is not confused by zero-width or styled span rects.
- Empty blocks: sticky column capture and comparison must treat empty content as "on the only visual line" (both first and last).
- Multi-line paragraphs that wrap: sticky column survives wrapping within a block and is only consulted at cross-block boundaries.

## Test file layout

Scenarios above map 1:1 to `test.describe` groups in `tests/sticky-column.spec.ts`:

- basic capture and cross-block
- survive intermediate clamping
- reset triggers
- preserve triggers
- container traversal
- opaque and transparent blocks
- edge cases
- rapid cross-block navigation (timing)

When the spec file is split (per `code-review-findings.md` H2), each group becomes its own file with a matching requirement file.
