<script lang="ts">
	import type { CstNode, BlockComponent } from '../contracts';
	import SelectionOverlay from './SelectionOverlay.svelte';
	import { getBlockKindDescriptor } from '../tree-operations/block-kind-descriptor';
	import { getBlockComponent } from '../block-component-registry';
	import '../block-components';

	let {
		node,
		index,
		parentPath = [],
		ambientPrefix = '',
		ref = $bindable()
	}: {
		node: CstNode;
		index: number;
		parentPath?: number[];
		ambientPrefix?: string;
		ref?: BlockComponent;
	} = $props();

	let myPath = $derived([...parentPath, index]);

	let isContainer = $derived(getBlockKindDescriptor(node.kind).isContainer);

	let hostEl: HTMLElement | null = $state(null);

	let entry = $derived(getBlockComponent(node.kind));
</script>

<div class="block-host" data-block-path={JSON.stringify(myPath)} bind:this={hostEl}>
	{#if entry}
		{@const Comp = entry.component}
		<Comp
			{node}
			{index}
			{myPath}
			{ambientPrefix}
			bind:this={ref}
			{...entry.extraProps?.(node) ?? {}}
		/>
	{/if}
	<!-- hostEl is null until mount; safe because SelectionState is only
		 populated by user gesture, never synchronously during structural
		 mount. The overlay's $effect guards on !blockEl. -->
	<SelectionOverlay path={myPath} blockRef={ref} blockEl={hostEl} {isContainer} />
</div>

<style>
	.block-host {
		position: relative;
	}
</style>
