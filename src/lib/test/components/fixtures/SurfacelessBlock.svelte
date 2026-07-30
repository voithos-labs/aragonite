<script lang="ts">
	// A block component that publishes NEITHER sanctioned surface shape: no
	// `BlockComponent` members of its own, and no container `containerApi`. It only
	// reaches the registry through a cast — `defineBlockComponent` rejects it — so it
	// stands in for the one hole the type cannot see, and for the shape a container
	// that forgot its one export actually publishes.
	import type { NodeView } from '../../../core/node-views';

	let { node }: { node: NodeView } = $props();
</script>

<div class="surfaceless-block">{node.raw}</div>
