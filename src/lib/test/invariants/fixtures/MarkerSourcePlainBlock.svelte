<script lang="ts">
	// A plain-mode leaf on the platform's own caret door, painting its bytes as marker chrome:
	// the single-text-node sync leaves the span alone (its textContent already matches), so the
	// shared factory's `parkCaret` seats a caret where the mode paints nothing.
	import { createEditableLeaf, type BlockComponent, type NodeView } from '$lib/plugin';

	let { node, index, myPath = [] }: { node: NodeView; index: number; myPath?: number[] } = $props();

	let sourceEl: HTMLDivElement | undefined = $state();

	const leaf = createEditableLeaf({
		getNode: () => node,
		getIndex: () => index,
		getPath: () => myPath,
		getEl: () => sourceEl ?? null,
		mode: 'plain'
	});

	export const editable = true;
	export const focusable = true;

	export const focus = leaf.focus;
	export const parkCaret = leaf.parkCaret;
	export const focusAtColumn = leaf.focusAtColumn;
	export const getCursorOffset = leaf.getCursorOffset;
	export const measurePartialRects = leaf.measurePartialRects;

	void ({
		editable,
		focusable,
		focus,
		parkCaret,
		focusAtColumn,
		getCursorOffset,
		measurePartialRects
	} satisfies BlockComponent);
</script>

<div bind:this={sourceEl} {...leaf.surfaceProps} class="marker-plain-block">
	<span class="md-marker">{leaf.sourceText}</span>
</div>
