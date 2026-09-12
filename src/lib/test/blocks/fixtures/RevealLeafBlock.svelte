<script lang="ts">
	// A render-primary editable leaf whose `singleLine` is a prop, so one fixture drives both
	// Enter contracts and the two cases differ in nothing else.
	import { createEditableLeaf, type NodeView } from '$lib/plugin';

	let {
		node,
		index,
		myPath = [],
		singleLine = false,
		painted = false
	}: {
		node: NodeView;
		index: number;
		myPath?: number[];
		singleLine?: boolean;
		/** Paint the source as DOM, which is what gives the reveal an undo stack of its own. */
		painted?: boolean;
	} = $props();

	let sourceEl: HTMLDivElement | undefined = $state();
	let revealed = $state(false);

	// Static config, captured once on purpose: the factory reads it at the call, not live.
	// svelte-ignore state_referenced_locally
	const oneLine = singleLine;
	// svelte-ignore state_referenced_locally
	const paintSource = painted
		? (text: string) => {
				const fragment = document.createDocumentFragment();
				fragment.append(document.createTextNode(text));
				return fragment;
			}
		: undefined;

	const leaf = createEditableLeaf({
		getNode: () => node,
		getIndex: () => index,
		getPath: () => myPath,
		getEl: () => sourceEl ?? null,
		mode: 'render-primary',
		singleLine: oneLine,
		renderSource: paintSource,
		isRevealed: () => revealed,
		setRevealed: (next) => (revealed = next)
	});

	export const editable = true;
	export const focusable = true;
	export const focus = leaf.focus;
	export const parkCaret = leaf.parkCaret;
	export const getCursorOffset = leaf.getCursorOffset;
</script>

<!-- The spread sits on a wrapper the fold keeps, the shape the guide documents. -->
<div class="reveal-leaf-block" {...leaf.renderProps}>
	{#if revealed}
		<div bind:this={sourceEl} {...leaf.surfaceProps} class="reveal-leaf-source"></div>
	{:else}
		<div class="reveal-leaf-render">{node.raw}</div>
	{/if}
</div>

<style>
	.reveal-leaf-source {
		white-space: pre-wrap;
	}
</style>
