<script lang="ts">
	// A block component that exports neither of the two allowed shapes: no
	// `BlockComponent` members of its own, and no container `containerApi`. It reaches
	// the registry only through a cast, since `defineBlockComponent` rejects it, so it
	// stands in for the one gap the types cannot see, and for what a container that
	// forgot its one export actually hands over.
	import type { NodeView } from '../../../core/node-views';

	let { node }: { node: NodeView } = $props();
</script>

<div class="surfaceless-block">{node.raw}</div>
