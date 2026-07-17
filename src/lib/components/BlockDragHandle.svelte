<!-- aria-hidden + non-focusable span: keyboard reorder (Alt+Arrow) is the operable,
	screen-reader-visible path. This grip is a mouse-only affordance and stays out of
	the tab/SR flow. Reveal-on-hover lives on the host (.block-host / .list-item-block)
	as a pure-CSS rule — no per-block reactive state. -->
<span class="block-drag-handle" aria-hidden="true" title="Drag to reorder — or Alt+↑ / Alt+↓">
	<span class="grip"><span class="dots"></span></span>
</span>

<style>
	.block-drag-handle {
		position: absolute;
		/* Offset fits within an unindented block's only left margin — the editor's 1rem
		   padding — so the grip clears the left border instead of being clipped behind it
		   (overflow-x:auto). Kept off the document content rather than widening the
		   editor's padding, which would inset every block (a document should feel like a
		   document) and shift layout under pixel-measured caret tests. */
		left: -0.85rem;
		/* Bridge the margin between the dots and the block: the hit area spans from the
		   gutter to the block's content-left (width === |left|), so a pointer gliding
		   from the block onto the handle never crosses an un-hovered gap (which would
		   hide the handle, and — being pointer-events:none once hidden — strand it
		   unreachable). The right edge stops AT content-left, never past it, so caret /
		   marker clicks at line-start aren't hijacked into a drag. */
		width: 0.85rem;
		/* Full-height hit strip: the grab area covers the block's whole vertical slice,
		   so the handle is reachable when approached at ANY height (a tall code block's
		   middle, not just its top). The visible grip is aligned to the first line. */
		top: 0;
		bottom: 0;
		display: flex;
		align-items: flex-start;
		opacity: 0;
		pointer-events: none;
		cursor: grab;
		user-select: none;
		color: var(--color-ui-muted, #a4a4a4);
	}

	/* A one-line-height box at the block's top with the dots centered in it, so the
	   grip sits on the first line wherever the handle inherits the content's
	   line-height (the common case). Off-by-a-couple-px on blocks that set a divergent
	   line-height on an inner element is cosmetic — reachability rides the strip. */
	.grip {
		display: flex;
		align-items: center;
		height: 1lh;
	}

	.dots {
		display: block;
		width: 0.5rem;
		height: 0.85rem;
		background-image: radial-gradient(currentColor 40%, transparent 45%);
		background-size: 0.25rem 0.28rem;
	}
</style>
