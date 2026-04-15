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
- **Code blocks** participate fully as of 0.3.5. They share the same `focusAtColumn` implementation as prose blocks — entry from above probes the first visual line (the opener fence line, which may also carry a language info string), entry from below probes the last visual line (the closer fence line), and the cursor lands at the offset whose rect is nearest the sticky X on that line. Interior body lines are reached by subsequent within-block vertical arrows, which rely on the browser's native sticky column.
- **Transparent blocks** (thematic break): pass the sticky value through without capturing or resetting. The caret traverses the block as a unit; the next cross-block move continues with the existing column value.

## Container traversal

The sticky column survives entering and exiting containers (blockquote, list, nested list). A cross-container move from outside into the first or last prose leaf of a container preserves the column; an inner vertical move between siblings inside a container likewise preserves it.

## Rapid navigation timing

Rapid successive vertical arrow presses across multiple blocks must all consult the same captured column value — no race between the DOM focus flush and the next keydown should cause the sticky state to reset mid-sequence. The `isAtFirstVisualLine` / `isAtLastVisualLine` geometry checks must tolerate back-to-back keypresses without leaking intermediate layout states.

## Edge cases

- Blocks whose first or last child is a dimmed marker span (heading `## `, code span markers): the visual-line geometry must walk past the marker to the real text node so sticky-column measurement is not confused by zero-width or styled span rects.
- Empty blocks: sticky column capture and comparison must treat empty content as "on the only visual line" (both first and last).
- Multi-line paragraphs that wrap: sticky column survives wrapping within a block and is only consulted at cross-block boundaries.

## Code block entry symmetry

When the same sticky X is captured from a block above and a block below a code block, entering via ArrowDown and ArrowUp respectively must land the cursor at the same pixel X (and the same body offset) inside the code block. This isolates regressions in `findOffsetNearestX` / `CodeBlock.focusAtColumn`.

- **Single-line body**: both entries land at the same visual-line position.
- **Multi-line body (same first/last body line width)**: landing is symmetric regardless of interior content.
- **Info string opener** (e.g. ```` ```javascript ````): the opener visual line is wider than the closer, but landing given matched sticky X is still symmetric.
- **highlight.js token spans**: the body line is fragmented into many adjacent token spans; rect lookup across span boundaries must not introduce direction-dependent drift.
- **Real document regression** (`DEFAULT_CONTENT` from the `/test/editor` harness): the multi-block `javascript` code block in the canonical test document serves as the lived-in regression case.

## Test file layout

The sticky-column spec has been split across five files. Scenarios above map to `test.describe` groups across these files:

- `sticky-column-capture.spec.ts` — basic capture and cross-block; survive intermediate clamping
- `sticky-column-triggers.spec.ts` — reset triggers; preserve triggers
- `sticky-column-containers.spec.ts` — container traversal; transparent blocks; edge cases
- `sticky-column-timing.spec.ts` — rapid cross-block navigation
- `sticky-column-code-block-entry.spec.ts` — code block entry symmetry
