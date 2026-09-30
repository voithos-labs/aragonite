<script lang="ts">
	import type { Decoration } from '$lib/plugin';

	// The widget contract passes the decoration in; the ghost is fixed text, so the prop
	// only gives the component the type the contract expects.
	let { decoration: _decoration }: { decoration: Decoration } = $props();
</script>

<span class="ghost-text">keep writing…</span>

<style>
	.ghost-text {
		color: var(--color-text-muted, #888);
		opacity: 0.6;
		font-style: italic;
		user-select: none;
		white-space: nowrap;
	}
</style>
