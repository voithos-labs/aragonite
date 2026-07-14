<script lang="ts">
	import type { Decoration } from '$lib/plugin';

	// The widget contract delivers the decoration; the ghost is static text, so
	// the prop only anchors the component's spec type.
	let { decoration: _decoration }: { decoration: Decoration } = $props();
</script>

<span class="ghost-text">keep writing…</span>

<style>
	.ghost-text {
		color: var(--color-text-secondary, #888);
		opacity: 0.6;
		font-style: italic;
		user-select: none;
		white-space: nowrap;
	}
</style>
