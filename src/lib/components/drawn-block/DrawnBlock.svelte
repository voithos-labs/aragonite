<!--
  What BlockHost renders for a block type a plugin draws with `draw`. A new drawing (the block's
  type changed) draws a fresh one, since the editable leaf behind its text is made once.
-->
<script lang="ts">
	import type { BlockComponent } from '../../block-component';
	import type { NodeView } from '../../core/node-views';
	import type { Drawing } from '../../schema/drawing';
	import DrawnBody from './DrawnBody.svelte';

	let {
		drawing,
		node,
		index,
		myPath
	}: { drawing: Drawing; node: NodeView; index: number; myPath: number[] } = $props();

	let body: { viewRef(): BlockComponent | undefined } | undefined = $state();

	export function viewRef(): BlockComponent | undefined {
		return body?.viewRef();
	}
</script>

{#key drawing}
	<DrawnBody {drawing} {node} {index} {myPath} bind:this={body} />
{/key}
