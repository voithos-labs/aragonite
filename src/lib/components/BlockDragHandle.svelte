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
		/* Sits inside the editor's own 1rem padding, so the grip clears the block's left
		   border instead of being clipped behind it (overflow-x:auto). */
		left: -0.85rem;
		/* Spans gutter to content-left (width === |left|) so a pointer gliding from the
		   block never crosses an un-hovered gap, which would hide the handle and — being
		   pointer-events:none once hidden — strand it. Stopping AT content-left keeps
		   line-start caret/marker clicks from being hijacked into a drag. */
		width: 0.85rem;
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

	/* Centred on the measured first line (an inline `top`, written by the hover attachment);
	   before any hover, and on touch, the host's own half line-height stands in. */
	.grip {
		position: absolute;
		left: 0;
		width: 100%;
		height: 1.25rem;
		top: 0.5lh;
		transform: translateY(-50%);
		display: flex;
		align-items: center;
		justify-content: center;
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
		}
	}
</style>
