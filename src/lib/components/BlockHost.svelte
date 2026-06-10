<script lang="ts">
	import type { AmbientPrefix, BlockComponent } from '../block-component';
	import type { CstNode } from '../core/nodes';
	import SelectionOverlay from './SelectionOverlay.svelte';
	import TextEditableBlock from './blocks/TextEditableBlock.svelte';
	import { getBlockKindDescriptor } from '../schema/block-kind-descriptor';
	import { getBlockComponent } from '../schema/block-component-registry';
	import { publishRefSlot } from '../reactivity/publish-ref.svelte';
	import { devWarn } from '../dev-warn';

	let {
		node,
		index,
		parentPath = [],
		ambientPrefix = '',
		setRef,
		getRef
	}: {
		node: CstNode;
		index: number;
		parentPath?: number[];
		ambientPrefix?: AmbientPrefix;
		setRef?: (i: number, r: BlockComponent | undefined) => void;
		getRef?: (i: number) => BlockComponent | undefined;
	} = $props();

	let myPath = $derived([...parentPath, index]);

	let isContainer = $derived(getBlockKindDescriptor(node.kind).isContainer);

	let hostEl: HTMLElement | null = $state(null);
	let ref: BlockComponent | undefined = $state();

	let entry = $derived(getBlockComponent(node.kind));

	// A kind with no registered component falls back to a visible raw-editable
	// surface (below) rather than silently rendering nothing.
	$effect(() => {
		if (!entry) devWarn('block-host', 'no component for kind, rendering raw', node.kind);
	});

	$effect(() => {
		if (!setRef || !getRef) return;
		return publishRefSlot(index, ref, setRef, getRef);
	});
</script>

<div
	class="block-host"
	data-block-path={JSON.stringify(myPath)}
	data-block-kind={node.kind}
	bind:this={hostEl}
>
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
	{:else}
		<TextEditableBlock
			{node}
			{index}
			{myPath}
			{ambientPrefix}
			bind:this={ref}
			blockClass="raw-block"
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
