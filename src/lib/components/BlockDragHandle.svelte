<script lang="ts">
	import { DRAG_HANDLE_TITLE } from '../a11y-strings';
</script>

<!-- aria-hidden + non-focusable: keyboard reorder (Alt+Arrow) is the operable,
	screen-reader-visible path, so this mouse-only grip stays out of the tab/SR flow. -->
<span class="block-drag-handle" aria-hidden="true" title={DRAG_HANDLE_TITLE}>
	<span class="grip"><span class="dots"></span></span>
</span>

<style>
	.block-drag-handle {
		position: absolute;
		/* Sits inside the editor's own 1rem padding, so the grip clears the block's left
		   border instead of being clipped behind it (overflow-x:auto). */
		left: -0.85rem;
		/* Spans gutter to content-left (width === |left|) so a pointer gliding from the
		   block never crosses an un-hovered gap, which would hide the handle and — being
		   pointer-events:none once hidden — strand it. Stopping AT content-left keeps
		   line-start caret/marker clicks from being hijacked into a drag. */
		width: 0.85rem;
		/* Full-height hit strip so the handle is reachable at ANY height; the visible
		   grip aligns to the first line. */
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

	/* One line-height box so the dots sit on the first line; a block with a divergent
	   inner line-height is off by a few px, which is cosmetic — reachability rides the strip. */
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

	/* Touch never fires the hover reveal, so the handle shows unasked. The pointer goes to the
	   grip rather than the full-height strip, which would make the whole gutter unscrollable. */
	@media (hover: none) {
		.block-drag-handle {
			opacity: 1;
		}
		.grip {
			pointer-events: auto;
			touch-action: none;
			/* The whole gutter slot, not just the dots: 1rem of editor padding is all the width
			   there is, and any more would reach over the line's first character. */
			width: 100%;
			justify-content: center;
		}
	}
</style>
