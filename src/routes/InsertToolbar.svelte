<script lang="ts">
	/**
	 * An insert toolbar as a consumer would write one, the strip under the showcase header: every
	 * construct is a Markdown snippet passed to `insertMarkdown`, a plugin's included, so the bar
	 * needs no API of its own per construct (consumer-guide/recipes.md § Recipe: an insert toolbar).
	 */
	import type { EditorInstance, InsertMarkdownOptions } from '#lib';

	type Snippet = { name: string; title: string; md: string; options?: InsertMarkdownOptions };

	// One line after text goes in as text, so the rule, the one snippet of one line, asks for a
	// paragraph of its own below the caret's block.
	const SNIPPETS: Snippet[] = [
		{
			name: 'table',
			title: 'Insert a table',
			md: '| Column | Column |\n| --- | --- |\n|  |  |\n'
		},
		{
			name: 'rule',
			title: 'Insert a horizontal rule',
			md: '---\n',
			options: { placement: 'below' }
		},
		{ name: 'code', title: 'Insert a code fence', md: '```\n\n```\n' },
		{ name: 'note', title: 'Insert a note admonition', md: ':::note\n\n:::\n' },
		{ name: 'math', title: 'Insert a math block', md: '$$\n\n$$\n' }
	];

	let { editor }: { editor: EditorInstance | undefined } = $props();

	// `insertMarkdown` inserts at the caret, so the bar greys out while the editor has none:
	// the same refusal that call would make, read before the click.
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
			onclick={() => editor?.insertMarkdown(snippet.md, snippet.options)}
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
