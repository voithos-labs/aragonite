<script lang="ts">
	import type { CstNode, BlockComponent } from '../editor-types';
	import TextEditableBlock from './TextEditableBlock.svelte';
	import ThematicBreakBlock from './ThematicBreakBlock.svelte';
	import CodeBlock from './CodeBlock.svelte';
	import BlockquoteBlock from './BlockquoteBlock.svelte';
	import ListBlock from './ListBlock.svelte';

	let {
		node = $bindable(),
		index,
		ref = $bindable()
	}: { node: CstNode; index: number; ref?: BlockComponent } = $props();

	function headingClass(): string {
		const level = (node.metadata as { level?: number })?.level ?? 1;
		return `heading-${level}`;
	}
</script>

{#if node.kind === 'paragraph'}
	<TextEditableBlock bind:node {index} bind:this={ref} blockClass="paragraph-block" />
{:else if node.kind === 'heading' || node.kind === 'setextHeading'}
	<TextEditableBlock bind:node {index} bind:this={ref} blockClass={headingClass()} />
{:else if node.kind === 'thematicBreak'}
	<ThematicBreakBlock bind:node {index} bind:this={ref} />
{:else if node.kind === 'fencedCode'}
	<CodeBlock bind:node {index} bind:this={ref} />
{:else if node.kind === 'blockquote'}
	<BlockquoteBlock bind:node {index} bind:this={ref} />
{:else if node.kind === 'list'}
	<ListBlock bind:node {index} bind:this={ref} />
{:else}
	<!-- All other leaf types: raw editable (indentedCode, htmlBlock,
		 linkReferenceDefinition, table, unrecognized) -->
	<TextEditableBlock bind:node {index} bind:this={ref} blockClass="raw-block" />
{/if}
