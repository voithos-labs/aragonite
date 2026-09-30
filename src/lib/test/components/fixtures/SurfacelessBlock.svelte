<script lang="ts">
	// A block component that exports neither `BlockComponent` members nor a `containerApi`,
	// registered through a cast since `defineBlockComponent` rejects it: what a container that
	// forgot its one export hands over.
	import type { NodeView } from '../../../core/node-views';

	let { node }: { node: NodeView } = $props();
</script>

<div class="surfaceless-block">{node.raw}</div>
