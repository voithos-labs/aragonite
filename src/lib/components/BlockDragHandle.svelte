<script lang="ts">
	import { DRAG_HANDLE_TITLE } from '../a11y-strings';
	import MenuIcon from './menu/MenuIcon.svelte';
	import { alignDragHandle } from './drag-handle';
</script>

<!-- aria-hidden and not focusable: keyboard reorder (Alt+Arrow) is the path a screen
	reader sees and can operate, so this mouse-only handle stays out of the tab order. -->
<span
	class="block-drag-handle"
	aria-hidden="true"
	title={DRAG_HANDLE_TITLE}
	{@attach alignDragHandle}
>
	<span class="grip"><MenuIcon name="grip-vertical" size={16} /></span>
</span>

<style>
	.block-drag-handle {
		position: absolute;
		/* Sits inside the editor's own left padding, so the handle clears the block's left
		   border instead of being clipped behind it (overflow-x:auto). */
		left: -1.25rem;
		/* Runs from the gutter to the content's left edge (width equals |left|) so a pointer
		   moving in from the block never crosses an unhovered gap, which would hide the handle
		   and, since a hidden one takes no pointer events, leave it unreachable. Stopping at
		   the content's left edge keeps a click on the first character from starting a drag. */
		width: 1.25rem;
		/* Full-height click strip so the handle is reachable at any height; the visible
		   handle sits on the block's first line. */
		top: 0;
		bottom: 0;
		opacity: 0;
		pointer-events: none;
		cursor: grab;
		user-select: none;
		color: var(--color-ui-muted, #a4a4a4);
	}

	/* Flush left in the strip (the glyph ends a few pixels clear of the content), centred on
	   the line that `alignDragHandle` measures and writes as an inline `top`.

	   Always clickable, unlike the strip around it: a handle you can reach only by first
	   hovering its block is a menu you cross the block to open. Its own box, not the
	   full-height strip, which would swallow every gutter click the block has. */
	.grip {
		position: absolute;
		left: 0;
		width: 100%;
		height: 1.25rem;
		/* the em line gives the same first-line centre in browsers without lh (Safari < 16.4) */
		top: 0.75em;
		top: 0.5lh;
		transform: translateY(-50%);
		display: flex;
		align-items: center;
		justify-content: flex-start;
		pointer-events: auto;
	}

	/* The click target is bigger than the glyph: a 16px box in a gutter is one the pointer
	   misses between two rows, and a miss reads as the handle belonging to the block above.
	   Never past the strip's right edge, which is the content's first character. */
	.grip::before {
		content: '';
		position: absolute;
		inset: -8px 0 -8px -4px;
	}

	/* Touch never triggers the hover rule, so the handle is shown from the start. */
	@media (hover: none) {
		.block-drag-handle {
			opacity: 1;
		}
		.grip {
			touch-action: none;
		}
	}
</style>
