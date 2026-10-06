<script lang="ts">
	/**
	 * Paints the space between the blocks a cross-block range runs through (padding, the margin to
	 * the next block), so the range reads as one region the way a code editor paints it. It fills
	 * only what no block's own selection paint covers, between the first painted line and the last.
	 */
	import { getContext, tick } from 'svelte';
	import { EDITOR_SERVICES_KEY, type EditorServices } from '../editor-keys';
	import { holesBetween } from '../cursor/overlay-rects';
	import { observeResize } from '../cursor/observe-resize';
	import { pathsEqual } from '../selection/path-math';

	let { getEditorEl }: { getEditorEl: () => HTMLElement | null } = $props();

	const services = getContext<EditorServices | undefined>(EDITOR_SERVICES_KEY);

	// A range inside one block keeps the browser's highlight, or one table's cell rectangle.
	const spansBlocks = $derived.by(() => {
		const start = services?.selection.start;
		const end = services?.selection.end;
		return !!start && !!end && !!services?.rangeCoverage() && !pathsEqual(start.path, end.path);
	});

	let gaps: { left: number; top: number; width: number; height: number }[] = $state([]);

	$effect(() => {
		const root = getEditorEl();
		const list = root?.querySelector<HTMLElement>(':scope > .block-list') ?? null;
		if (!spansBlocks || !root || !list) {
			gaps = [];
			return;
		}

		// In the root's scrolled content, so a gap scrolls with the blocks and needs no re-measure.
		function measure(): void {
			if (!root || !list) return;
			const origin = root.getBoundingClientRect();
			const column = list.getBoundingClientRect();
			const painted = [...list.querySelectorAll('.selection-overlay')]
				.map((el) => el.getBoundingClientRect())
				.filter((r) => r.width > 0 && r.height > 0);
			const top = root.scrollTop - origin.top - root.clientTop;
			const left = column.left - origin.left - root.clientLeft + root.scrollLeft;
			gaps = holesBetween(painted).map((hole) => ({
				left,
				top: hole.top + top,
				width: column.width,
				height: hole.bottom - hole.top
			}));
		}

		let live = true;
		// The blocks paint in their own effects, so the first read waits for their flush.
		(async () => {
			await tick();
			if (live) measure();
		})();

		// Every later change to a block's paint is a change to its overlay elements.
		const observer = new MutationObserver((records) => {
			if (records.some(touchesOverlay)) measure();
		});
		observer.observe(list, {
			subtree: true,
			childList: true,
			attributes: true,
			attributeFilter: ['style', 'class']
		});
		const stopResize = observeResize(list, measure);
		return () => {
			live = false;
			observer.disconnect();
			stopResize();
		};
	});

	function isOverlay(node: Node): boolean {
		return node instanceof Element && node.classList.contains('selection-overlay');
	}

	function touchesOverlay(record: MutationRecord): boolean {
		return (
			isOverlay(record.target) ||
			[...record.addedNodes].some(isOverlay) ||
			[...record.removedNodes].some(isOverlay)
		);
	}
</script>

{#each gaps as gap, i (i)}
	<div
		class="selection-overlay selection-overlay-gap"
		aria-hidden="true"
		style="left: {gap.left}px; top: {gap.top}px; width: {gap.width}px; height: {gap.height}px;"
	></div>
{/each}

<style>
	.selection-overlay-gap {
		position: absolute;
		pointer-events: none;
		background-color: var(--selection-overlay-bg, rgba(100, 150, 255, 0.3));
		z-index: 1;
	}
</style>
