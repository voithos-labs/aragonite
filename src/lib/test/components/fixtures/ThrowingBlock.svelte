<script lang="ts">
	// Throws during init while its raw holds the trigger word, so one mounted host can
	// be driven from failed to working again by a byte change alone.
	import type { NodeView } from '../../../core/node-views';

	let { node }: { node: NodeView } = $props();

	// The throw must happen during mount, the failure the host's boundary exists to catch.
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
