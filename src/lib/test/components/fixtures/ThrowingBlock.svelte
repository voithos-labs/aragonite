<script lang="ts">
	// Throws during init while its raw carries the trigger word, so one mounted host
	// can be driven from failed to healed by a byte change alone.
	import type { NodeView } from '../../../core/node-views';

	let { node }: { node: NodeView } = $props();

	// Reading at init is the point: the throw must happen during the child's
	// mount, which is the failure the host's boundary exists to catch.
	// svelte-ignore state_referenced_locally
	if (node.raw.includes('boom')) throw new Error('render exploded');

	export const editable = true;
	export const focusable = true;
	export function focus(): void {}
	export function getCursorOffset(): number | null {
		return null;
	}
</script>

<div class="throwing-block">{node.raw}</div>
