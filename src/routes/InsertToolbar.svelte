<script lang="ts">
	/**
	 * Consumer-side insert-toolbar example, the fixed sibling of `SelectionToolbar`: every
	 * construct is a Markdown snippet through `insertMarkdown`, a plugin's included, so the bar
	 * needs no per-construct API (consumer-guide.md § Recipe: an insert toolbar).
	 */
	import type { EditorInstance } from '$lib';

	const SNIPPETS = [
		{
			name: 'table',
			title: 'Insert a table',
			md: '| Column | Column |\n| --- | --- |\n|  |  |\n'
		},
		{ name: 'rule', title: 'Insert a horizontal rule', md: '---\n' },
		{ name: 'code', title: 'Insert a code fence', md: '```\n\n```\n' },
		{ name: 'note', title: 'Insert a note admonition', md: ':::note\n\n:::\n' },
		{ name: 'math', title: 'Insert a math block', md: '$$\n\n$$\n' }
	] as const;

	let { editor }: { editor: EditorInstance | undefined } = $props();

	// The door inserts at the caret, so the bar greys while the editor holds none — the same
	// no-caret decline `insertMarkdown` answers, read ahead of the click.
	let hasCaret = $state(false);
	$effect(() => {
		if (!editor) return;
		return editor.getEvents().on('selectionChange', (selection) => (hasCaret = selection !== null));
	});
</script>

<div class="insert-toolbar" data-testid="insert-toolbar">
	{#each SNIPPETS as snippet (snippet.name)}
		<button
			type="button"
			class="insert-btn"
			data-testid="insert-{snippet.name}"
			title={snippet.title}
			disabled={!hasCaret}
			onmousedown={(e) => e.preventDefault()}
			onclick={() => editor?.insertMarkdown(snippet.md)}
		>
			+ {snippet.name}
		</button>
	{/each}
</div>

<style>
	.insert-toolbar {
		flex: 0 0 auto;
		display: flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.3rem 1rem;
		font-family: var(--font-editor, ui-monospace, monospace);
		font-size: 0.75rem;
	}
	.insert-btn {
		padding: 0.1rem 0.45rem;
		border: none;
		border-radius: 4px;
		background: transparent;
		color: var(--color-text-muted, #888);
		font-family: inherit;
		font-size: inherit;
		cursor: pointer;
	}
	.insert-btn:hover:not(:disabled) {
		color: var(--color-text-primary, #fff);
		background: var(--color-bg-secondary, rgba(128, 128, 128, 0.18));
	}
	.insert-btn:disabled {
		opacity: 0.45;
		cursor: default;
	}
</style>
