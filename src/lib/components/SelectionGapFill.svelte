<script lang="ts">
	/**
	 * Paints what the blocks' own selection paint leaves bare between a cross-block range's first
	 * line and its last (padding, the margin to the next block, a container's rail or indent), so
	 * the range reads as one region spanning the block column, the way a code editor paints it.
	 */
	import { getContext, tick } from 'svelte';
	import { EDITOR_SERVICES_KEY, type EditorServices } from '../editor-keys';
	import { regionGaps } from '../cursor/overlay-rects';
	import { observeResize } from '../cursor/observe-resize';
	import { rangeSpansBlocks } from '../selection/primitives';

	let { getEditorEl }: { getEditorEl: () => HTMLElement | null } = $props();

	const services = getContext<EditorServices | undefined>(EDITOR_SERVICES_KEY);

	// A block's own paint, never a gap rect: reading or observing those would re-measure forever.
	const BLOCK_PAINT = '.selection-overlay:not(.selection-overlay-gap)';

	const spansBlocks = $derived.by(() => {
		const coverage = services?.rangeCoverage();
		return !!coverage && rangeSpansBlocks(coverage);
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
			const painted = [...list.querySelectorAll(BLOCK_PAINT)].flatMap((el) => {
				const r = el.getBoundingClientRect();
				const endpoint = el.classList.contains('selection-overlay-endpoint');
				return r.width > 0 && r.height > 0
					? [{ left: r.left, top: r.top, right: r.right, bottom: r.bottom, endpoint }]
					: [];
			});
			const dx = root.scrollLeft - origin.left - root.clientLeft;
			const dy = root.scrollTop - origin.top - root.clientTop;
			gaps = regionGaps(painted, column.left, column.right).map((gap) => ({
				left: gap.left + dx,
				top: gap.top + dy,
				width: gap.right - gap.left,
				height: gap.bottom - gap.top
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

	// A host that mounts or unmounts with its paint already inside counts too.
	function holdsBlockPaint(node: Node): boolean {
		return (
			node instanceof Element && (node.matches(BLOCK_PAINT) || !!node.querySelector(BLOCK_PAINT))
		);
	}

	function touchesOverlay(record: MutationRecord): boolean {
		return (
			(record.target instanceof Element && record.target.matches(BLOCK_PAINT)) ||
			[...record.addedNodes].some(holdsBlockPaint) ||
			[...record.removedNodes].some(holdsBlockPaint)
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
