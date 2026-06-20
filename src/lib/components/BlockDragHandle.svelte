<script lang="ts">
	let { onpointerdown }: { onpointerdown?: (e: PointerEvent) => void } = $props();
</script>

<!-- aria-hidden + non-focusable span: keyboard reorder (Alt+Arrow) is the operable,
	screen-reader-visible path. This grip is a mouse-only affordance and stays out of
	the tab/SR flow. Reveal-on-hover lives on the host (.block-host / .list-item-block)
	as a pure-CSS rule — no per-block reactive state. -->
<span class="block-drag-handle" aria-hidden="true" {onpointerdown}>
	<span class="dots"></span>
</span>

<style>
	.block-drag-handle {
		position: absolute;
		left: -1.25rem;
		top: 0.15em;
		opacity: 0;
		cursor: grab;
		user-select: none;
		color: var(--color-ui-muted, #a4a4a4);
	}

	.dots {
		display: block;
		width: 0.5rem;
		height: 0.85rem;
		background-image: radial-gradient(currentColor 40%, transparent 45%);
		background-size: 0.25rem 0.28rem;
	}
</style>
