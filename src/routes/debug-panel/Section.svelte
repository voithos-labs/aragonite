<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		title: string;
		expanded: boolean;
		onToggle: () => void;
		children: Snippet;
	}
	let { title, expanded, onToggle, children }: Props = $props();
</script>

<section class="debug-section" class:expanded data-section-title={title}>
	<button class="debug-section-header" onclick={onToggle} type="button">
		<span class="caret" aria-hidden="true">{expanded ? '▼' : '▶'}</span>
		<span class="title">{title}</span>
	</button>
	{#if expanded}
		<div class="debug-section-body">
			{@render children()}
		</div>
	{/if}
</section>

<style>
	.debug-section {
		border-bottom: 1px solid var(--color-border, #3d4047);
	}
	.debug-section-header {
		all: unset;
		width: 100%;
		padding: 6px 8px;
		display: flex;
		align-items: center;
		gap: 6px;
		cursor: pointer;
		font-weight: 600;
		color: var(--color-text, #d6d9e0);
	}
	.debug-section-header:hover {
		background: var(--color-ui-faint, rgba(255, 255, 255, 0.07));
	}
	.caret {
		width: 12px;
		font-size: 10px;
		color: var(--color-text-muted, #aaaaaa);
	}
	.debug-section-body {
		padding: 8px;
		font-family: var(--font-editor, ui-monospace, monospace);
		font-size: 12px;
		line-height: 1.4;
		color: var(--color-text, #d6d9e0);
		/* pre-wrap preserves the dumps' indentation; overflow-wrap breaks the long unbreakable
		   tokens (hex ids, spaceless raw snippets) that would force a horizontal scrollbar. */
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		overflow-x: auto;
	}
</style>
