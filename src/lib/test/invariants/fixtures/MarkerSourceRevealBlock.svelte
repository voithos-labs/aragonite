<script lang="ts">
	// A render-primary leaf whose revealed source paints its bytes as marker chrome: the
	// single-text-node sync leaves it alone (the textContent already matches), so the reveal
	// path seats a caret where the mode paints nothing.
	import { createEditableLeaf, type BlockComponent, type NodeView } from '$lib/plugin';

	let { node, index, myPath = [] }: { node: NodeView; index: number; myPath?: number[] } = $props();

	let sourceEl: HTMLDivElement | undefined = $state();
	let revealed = $state(false);

	const leaf = createEditableLeaf({
		getNode: () => node,
		getIndex: () => index,
		getPath: () => myPath,
		getEl: () => sourceEl ?? null,
		mode: 'render-primary',
		isRevealed: () => revealed,
		setRevealed: (next) => {
			revealed = next;
		}
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

{#if revealed}
	<div bind:this={sourceEl} {...leaf.surfaceProps} class="marker-source-block">
		<span class="md-marker">{leaf.sourceText}</span>
	</div>
{:else}
	<div
		class="marker-rendered-block"
		role="button"
		tabindex="-1"
		aria-label="Marker source (click to edit)"
		{...leaf.renderProps}
	>
		rendered
	</div>
{/if}
