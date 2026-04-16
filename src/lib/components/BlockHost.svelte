<script lang="ts">
	import type { CstNode, BlockComponent } from '../editor-types';
	import TextEditableBlock from './blocks/TextEditableBlock.svelte';
	import ThematicBreakBlock from './blocks/ThematicBreakBlock.svelte';
	import CodeBlock from './blocks/CodeBlock.svelte';
	import BlockquoteBlock from './blocks/BlockquoteBlock.svelte';
	import ListBlock from './blocks/ListBlock.svelte';

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

	function headingClass(): string {
		const level = (node.metadata as { level?: number })?.level ?? 1;
		return `heading-${level}`;
	}
</script>

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
