<script lang="ts">
	let {
		axis,
		onActivate,
		onpointerdown
	}: {
		axis: 'row' | 'column';
		onActivate: (e: MouseEvent) => void;
		onpointerdown?: (e: PointerEvent) => void;
	} = $props();

	function handlePointerDown(e: PointerEvent): void {
		// Keep the grip's own pointer stream off the editor's selection/focus
		// handlers; the affordance opens a menu, it doesn't place a caret.
		e.stopPropagation();
		onpointerdown?.(e);
	}
</script>

<!-- Mouse-only affordance: the cell chords are the operable, screen-reader path,
	so the grip stays out of the tab/SR flow (aria-hidden, non-focusable). Reveal
	is a pure-CSS host:hover rule in editor.css, not per-grip reactive state.
	onpointerdown is reserved for the roadmapped drag. -->
<span class="table-grip-anchor table-grip-anchor-{axis}">
	<span
		class="table-grip table-grip-{axis}"
		data-table-col-grip={axis === 'column' ? '' : undefined}
		data-table-row-grip={axis === 'row' ? '' : undefined}
		aria-hidden="true"
		onclick={onActivate}
		onpointerdown={handlePointerDown}
	></span>
</span>

<style>
	/* The anchor is the grid item: zero-height so it never adds a visible band or
	   shifts caret-measured layout, and the dots are absolutely positioned so they
	   never widen a column track. z-index lifts the grip above the cells — grips
	   render before the cells in DOM order, so without it the DOM-later header cell
	   would paint over the dots and eat the click. */
	.table-grip-anchor-column {
		position: relative;
		z-index: 2;
		height: 0;
	}

	/* A thin dotted bar centered at the very top of the column, sitting within the
	   header cell's top padding so it never overlaps the caret-click target. */
	.table-grip-column {
		position: absolute;
		top: 0;
		left: 50%;
		transform: translateX(-50%);
		width: 1.75rem;
		height: 0.35rem;
		color: var(--color-ui-muted, #a4a4a4);
		background-image: radial-gradient(currentColor 40%, transparent 45%);
		background-size: 0.25rem 0.35rem;
		background-repeat: repeat-x;
		background-position: center;
		cursor: pointer;
		opacity: 0;
		pointer-events: none;
	}
</style>
