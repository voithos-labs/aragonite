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
		// The affordance opens a menu, it doesn't place a caret, so the grip's pointer
		// stream stays off the editor's selection/focus handlers.
		e.stopPropagation();
		onpointerdown?.(e);
	}
</script>

<!-- Pointer-only affordance: the cell chords are the operable, screen-reader path, so the
	grip stays out of the tab/SR flow. Reveal is pure CSS: hover in editor.css, touch below. -->
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
	/* Zero-height so it never adds a visible band or shifts caret-measured layout;
	   z-index lifts the dots above the DOM-later header cell, which would eat the click. */
	.table-grip-anchor-column {
		position: relative;
		z-index: 2;
		height: 0;
	}

	/* The dotted bar shared by both axes; the axis rules add only the geometry. */
	.table-grip {
		position: absolute;
		color: var(--color-ui-muted, #a4a4a4);
		background-image: radial-gradient(currentColor 40%, transparent 45%);
		background-position: center;
		cursor: pointer;
		opacity: 0;
		pointer-events: none;
	}

	/* Sits within the header cell's top padding so it never overlaps the caret-click target. */
	.table-grip-column {
		top: 0;
		left: 50%;
		transform: translateX(-50%);
		width: 1.75rem;
		height: 0.35rem;
		background-size: 0.25rem 0.35rem;
		background-repeat: repeat-x;
	}

	/* Zero-width gutter item, stretched to the row height. z-index lifts the dots above
	   cell A, which renders DOM-later and would otherwise paint over them. */
	.table-grip-anchor-row {
		position: relative;
		z-index: 2;
	}

	/* Overflows out of the zero-width gutter into cell A's left padding, clear of the text. */
	.table-grip-row {
		top: 50%;
		left: 0.15rem;
		transform: translateY(-50%);
		width: 0.35rem;
		height: 1rem;
		background-size: 0.35rem 0.25rem;
		background-repeat: repeat-y;
	}

	/* Touch fires no hover, so the editor.css reveal never runs and an opted-in host's grips
	   would be unreachable. `touch-action` keeps a reorder drag off the table's own scroll. */
	@media (hover: none) {
		.table-grip {
			opacity: 1;
			pointer-events: auto;
			touch-action: none;
		}
	}
</style>
