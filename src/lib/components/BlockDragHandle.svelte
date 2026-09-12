<script lang="ts">
	import { DRAG_HANDLE_TITLE } from '../a11y-strings';
	import MenuIcon from './menu/MenuIcon.svelte';
	import { alignDragHandle } from './drag-handle';
</script>

<!-- aria-hidden + non-focusable: keyboard reorder (Alt+Arrow) is the operable,
	screen-reader-visible path, so this mouse-only grip stays out of the tab/SR flow. -->
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
		/* Sits inside the editor's own left padding, so the grip clears the block's left
		   border instead of being clipped behind it (overflow-x:auto). */
		left: -1.25rem;
		/* Spans gutter to content-left (width === |left|) so a pointer gliding from the
		   block never crosses an un-hovered gap, which would hide the handle and — being
		   pointer-events:none once hidden — strand it. Stopping AT content-left keeps
		   line-start caret/marker clicks from being hijacked into a drag. */
		width: 1.25rem;
		/* Full-height hit strip so the handle is reachable at ANY height; the visible
		   grip sits on the block's first line. */
		top: 0;
		bottom: 0;
		opacity: 0;
		pointer-events: none;
		cursor: grab;
		user-select: none;
		color: var(--color-ui-muted, #a4a4a4);
	}

	/* Flush left in the strip (the glyph ends a few px clear of the content), centred on the
	   measured band that `alignDragHandle` writes as an inline `top`.

	   ALWAYS hittable, unlike the strip around it: a grip reachable only by first hovering its
	   block is a flyout you traverse the block to get to. Its own box, not the full-height
	   strip, which would swallow every gutter click the block has. */
	.grip {
		position: absolute;
		left: 0;
		width: 100%;
		height: 1.25rem;
		top: 0.5lh;
		transform: translateY(-50%);
		display: flex;
		align-items: center;
		justify-content: flex-start;
		pointer-events: auto;
	}

	/* The hit target is bigger than the glyph: a 16px box in a gutter is a target the pointer
	   misses between two rows, and a miss here reads as the grip belonging to the block above.
	   Never past the strip's right edge, which is the content's first character. */
	.grip::before {
		content: '';
		position: absolute;
		inset: -8px 0 -8px -4px;
	}

	/* Touch never fires the hover reveal, so the handle shows unasked. */
	@media (hover: none) {
		.block-drag-handle {
			opacity: 1;
		}
		.grip {
			touch-action: none;
		}
	}
</style>
