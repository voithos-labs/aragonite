<script lang="ts">
	import type { MutableNode, BlockComponent } from '../editor-types';
	import TextEditableBlock from './TextEditableBlock.svelte';

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
{:else}
	<!-- Fallback: render raw text for all unhandled block types -->
	<div class="raw-block">
		<pre>{node.raw}</pre>
	</div>
{/if}

<style>
	.raw-block {
		padding: 2px 0;
		opacity: 0.7;
	}

	.raw-block pre {
		margin: 0;
		white-space: pre-wrap;
		font-family: inherit;
	}
</style>
