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
		// handlers; the affordance opens a menu, it doesn't place a caret. A drag
		// reorder (row axis) starts from the same stream — kept below the click
		// threshold a plain click still opens the menu.
		e.stopPropagation();
		onpointerdown?.(e);
	}
</script>

<!-- Mouse-only affordance: the cell chords are the operable, screen-reader path,
	so the grip stays out of the tab/SR flow (aria-hidden, non-focusable). Reveal
	is a pure-CSS host:hover rule in editor.css, not per-grip reactive state. -->
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

	/* The dotted-bar affordance shared by both axes; the axis rules add only the
	   geometry (position, size, repeat direction) that sets them apart. */
	.table-grip {
		position: absolute;
		color: var(--color-ui-muted, #a4a4a4);
		background-image: radial-gradient(currentColor 40%, transparent 45%);
		background-position: center;
		cursor: pointer;
		opacity: 0;
		pointer-events: none;
	}

	/* A thin dotted bar centered at the very top of the column, sitting within the
	   header cell's top padding so it never overlaps the caret-click target. */
	.table-grip-column {
		top: 0;
		left: 50%;
		transform: translateX(-50%);
		width: 1.75rem;
		height: 0.35rem;
		background-size: 0.25rem 0.35rem;
		background-repeat: repeat-x;
	}

	/* The anchor is the gutter grid item: zero-width (its track is `0`), stretched to
	   the row height. z-index lifts the dots above cell A, which renders DOM-later and
	   would otherwise paint over them and eat the click. */
	.table-grip-anchor-row {
		position: relative;
		z-index: 2;
	}

	/* A thin vertical dotted bar centered down the row, overflowing right out of the
	   zero-width gutter into cell A's left padding so it never overlaps the cell text. */
	.table-grip-row {
		top: 50%;
		left: 0.15rem;
		transform: translateY(-50%);
		width: 0.35rem;
		height: 1rem;
		background-size: 0.35rem 0.25rem;
		background-repeat: repeat-y;
	}
</style>
