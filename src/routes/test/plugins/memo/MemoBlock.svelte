<script lang="ts">
	// A plain-mode editable leaf: every editing behavior lives in `createEditableLeaf`, and
	// spreading `leaf.surfaceProps` sets up the whole editable element.
	import { createEditableLeaf, type NodeView } from '$lib/plugin';

	let { node, index, myPath = [] }: { node: NodeView; index: number; myPath?: number[] } = $props();

	let el: HTMLDivElement | undefined = $state();

	const leaf = createEditableLeaf({
		getNode: () => node,
		getIndex: () => index,
		getPath: () => myPath,
		getEl: () => el ?? null,
		mode: 'plain'
	});

	export const blockApi = leaf.blockApi;
</script>

<!-- The reference wiring for a leaf: one spread supplies every handler, attribute and
	attachment a plain leaf's always-mounted source needs. -->
<div bind:this={el} {...leaf.surfaceProps} class="memo-block" aria-label="Memo"></div>

<style>
	.memo-block {
		outline: none;
		width: 100%;
		box-sizing: border-box;
		padding: 2px 0 2px 10px;
		border-left: 3px solid var(--color-accent, #567b67);
		font-family: var(--font-editor, ui-monospace, monospace);
		font-size: 0.9em;
		white-space: pre-wrap;
		word-wrap: break-word;
		min-height: 1.4em;
	}
</style>
