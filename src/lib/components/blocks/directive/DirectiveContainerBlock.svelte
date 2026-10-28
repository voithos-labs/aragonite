<script lang="ts">
	// How an unregistered `:::name` directive renders, built on the same `createContainerBlock`
	// helper a plugin gets from the public barrel. Its opener line is its first child, over a left
	// border, not a card box: a document should look like a document.
	import { createContainerBlock } from '#lib/editor-actions/plugin/container.js';
	import BlockList from '#lib/components/BlockList.svelte';
	import type { NodeView } from '#lib/core/node-views.js';
	import { rowContentRange } from '#lib/schema/reserved-chrome.js';

	let { node, index, myPath = [] }: { node: NodeView; index: number; myPath?: number[] } = $props();

	let boxEl: HTMLElement | undefined = $state();

	// The `:::name` a mode that hides markers draws in place of the line's own, as a CSS string.
	const marker = $derived(
		JSON.stringify(node.children?.[0]?.raw.slice(0, rowContentRange(node).start) ?? '')
	);

	const { blockListProps, containerApi, handleKeydown } = createContainerBlock({
		getNode: () => node,
		getIndex: () => index,
		getPath: () => myPath,
		getBoxEl: () => boxEl
	});

	export { containerApi };
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="directive-block"
	style:--md-directive-marker={marker}
	bind:this={boxEl}
	onkeydown={handleKeydown}
>
	<BlockList {...blockListProps} />
</div>

<style>
	.directive-block {
		border-left: 2px solid var(--color-ui-muted);
		padding-left: 0.75em;
		margin: 6px 0;
	}
	.directive-block
		> :global(.block-list > [data-block-kind='directiveOpenerLine'] .directive-opener-line) {
		font-family: var(--font-code, ui-monospace, monospace);
	}

	/* Where the line's own `:::name` is hidden, a drawn copy keeps the line looking as it does in
	   source mode, so moving the caret on or off it changes nothing on screen. */
	:global(.editor[data-presentation='reading'])
		.directive-block
		> :global(.block-list > [data-block-kind='directiveOpenerLine'] .directive-opener-line::before),
	:global(.editor[data-presentation])
		.directive-block
		> :global(
			.block-list
				> [data-block-kind='directiveOpenerLine']
				.directive-opener-line:not(:focus-within)::before
		) {
		content: var(--md-directive-marker);
		opacity: var(--syntax-marker-dim, 0.65);
		font-weight: normal;
		font-style: normal;
		pointer-events: none;
		user-select: none;
	}
</style>
