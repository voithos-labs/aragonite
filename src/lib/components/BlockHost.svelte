<script lang="ts">
	import type { MutableNode, BlockComponent } from '../editor-types';
	import TextEditableBlock from './TextEditableBlock.svelte';
	import ThematicBreakBlock from './ThematicBreakBlock.svelte';
	import CodeBlock from './CodeBlock.svelte';

	let {
		node,
		index,
		ref = $bindable()
	}: { node: MutableNode; index: number; ref?: BlockComponent } = $props();

	function headingClass(): string {
		const level = (node.metadata as { level?: number })?.level ?? 1;
		return `heading-${level}`;
	}
</script>

{#if node.kind === 'paragraph'}
	<TextEditableBlock {node} {index} bind:this={ref} blockClass="paragraph-block" />
{:else if node.kind === 'heading' || node.kind === 'setextHeading'}
	<TextEditableBlock {node} {index} bind:this={ref} blockClass={headingClass()} />
{:else if node.kind === 'thematicBreak'}
	<ThematicBreakBlock {node} {index} bind:this={ref} />
{:else if node.kind === 'fencedCode'}
	<CodeBlock {node} {index} bind:this={ref} />
{:else}
	<!-- All other leaf types: raw editable (indentedCode, htmlBlock,
		 linkReferenceDefinition, table, unrecognized) -->
	<TextEditableBlock {node} {index} bind:this={ref} blockClass="raw-block" />
{/if}
