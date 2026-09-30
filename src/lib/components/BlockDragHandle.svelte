<script lang="ts">
	import { DRAG_HANDLE_TITLE } from '../a11y-strings';
	import MenuIcon from './menu/MenuIcon.svelte';
	import { alignDragHandle } from './drag-handle';
</script>

<!-- Hidden from assistive tech and the tab order: keyboard reorder (Alt+Arrow) is the
	accessible path. -->
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
		/* In the editor's left padding, so the block's `overflow-x: auto` cannot clip it. */
		left: -1.25rem;
		/* Reaches the content's left edge, so a pointer moving out of the block never crosses a
		   gap that would hide the handle, and stops there so the first character stays clickable. */
		width: 1.25rem;
		/* A full-height strip; the visible handle sits on the block's first line. */
		top: 0;
		bottom: 0;
		opacity: 0;
		pointer-events: none;
		cursor: grab;
		user-select: none;
		color: var(--color-ui-muted, #a4a4a4);
	}

	/* Centred on the line `alignDragHandle` measures. Always clickable, unlike the strip, so
	   the handle needs no hover first without the strip swallowing every gutter click. */
	.grip {
		position: absolute;
		left: 0;
		width: 100%;
		height: 1.25rem;
		/* The `em` fallback is for browsers without `lh` (Safari before 16.4). */
		top: 0.75em;
		top: 0.5lh;
		transform: translateY(-50%);
		display: flex;
		align-items: center;
		justify-content: flex-start;
		pointer-events: auto;
	}

	/* A click target bigger than the 16px glyph, which a pointer misses between rows; it never
	   passes the strip's right edge, the content's first character. */
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
