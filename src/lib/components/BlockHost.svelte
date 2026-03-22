<script lang="ts">
	import type { MutableNode, BlockComponent } from '../editor-types';
	import ParagraphBlock from './ParagraphBlock.svelte';

	let {
		node,
		index,
		ref = $bindable()
	}: { node: MutableNode; index: number; ref?: BlockComponent } = $props();
</script>

{#if node.kind === 'paragraph'}
	<ParagraphBlock {node} {index} bind:this={ref} />
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
