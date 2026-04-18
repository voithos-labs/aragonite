<script lang="ts">
	import type { CstNode, BlockComponent } from '../contracts';
	import TextEditableBlock from './blocks/TextEditableBlock.svelte';
	import ThematicBreakBlock from './blocks/ThematicBreakBlock.svelte';
	import CodeBlock from './blocks/CodeBlock.svelte';
	import BlockquoteBlock from './blocks/BlockquoteBlock.svelte';
	import ListBlock from './blocks/ListBlock.svelte';
	import SelectionOverlay from '../selection/SelectionOverlay.svelte';
	import { getBlockKindDescriptor } from '../tree-operations/block-kind-descriptor';

	let {
		node,
		index,
		parentPath = [],
		ref = $bindable()
	}: {
		node: CstNode;
		index: number;
		parentPath?: number[];
		ref?: BlockComponent;
	} = $props();

	let myPath = $derived([...parentPath, index]);

	let isContainer = $derived(getBlockKindDescriptor(node.kind).isContainer);

	let hostEl: HTMLElement | null = $state(null);

	function headingClass(): string {
		const level = (node.metadata as { level?: number })?.level ?? 1;
		return `heading-${level}`;
	}
</script>

<div class="block-host" data-block-path={JSON.stringify(myPath)} bind:this={hostEl}>
	{#if node.kind === 'paragraph'}
		<TextEditableBlock {node} {index} {myPath} bind:this={ref} blockClass="paragraph-block" />
	{:else if node.kind === 'heading' || node.kind === 'setextHeading'}
		<TextEditableBlock {node} {index} {myPath} bind:this={ref} blockClass={headingClass()} />
	{:else if node.kind === 'thematicBreak'}
		<ThematicBreakBlock {node} {index} {myPath} bind:this={ref} />
	{:else if node.kind === 'fencedCode'}
		<CodeBlock {node} {index} {myPath} bind:this={ref} />
	{:else if node.kind === 'blockquote'}
		<BlockquoteBlock {node} {index} {myPath} bind:this={ref} />
	{:else if node.kind === 'list'}
		<ListBlock {node} {index} {myPath} bind:this={ref} />
	{:else}
		<!-- All other leaf types: raw editable (indentedCode, htmlBlock,
			 linkReferenceDefinition, table, unrecognized) -->
		<TextEditableBlock {node} {index} {myPath} bind:this={ref} blockClass="raw-block" />
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
