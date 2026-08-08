<script module lang="ts">
	import { admonitionsPlugin } from '$lib/plugins/admonitions';
	import { detailsPlugin } from '$lib/plugins/details';
	import { tocPlugin } from '$lib/plugins/toc';
	import { footnotesPlugin } from '$lib/plugins/footnotes';
	import { emojiPlugin } from '$lib/plugins/emoji';
	import { highlightOccurrencesPlugin } from '$lib/plugins/highlight-occurrences';
	import { latexPlugin } from '$lib/plugins/latex';
	import { katexRenderer } from '$lib/plugins/latex/renderer';
	import { mermaidPlugin } from '$lib/plugins/mermaid';
	import { mermaidRenderer } from '$lib/plugins/mermaid/renderer';

	const changelogPlugins = [
		admonitionsPlugin(),
		detailsPlugin(),
		// Every version heading is `###`, so depth 3 holds the outline to versions.
		tocPlugin({ maxDepth: 3 }),
		footnotesPlugin(),
		emojiPlugin(),
		highlightOccurrencesPlugin(),
		latexPlugin({ renderer: katexRenderer }),
		mermaidPlugin({ renderer: mermaidRenderer })
	];
</script>

<script lang="ts">
	import { resolve } from '$app/paths';
	import { Editor, type PresentationMode } from '$lib';
	import { CHANGELOG_DOCUMENT } from './changelog-content';
	import { trackParityDocument } from '../parity-documents.svelte';

	// One live-changeable prop is the whole demo: the same render path over the same bytes,
	// rendered or as styled source. Reading is the default — this is a document to read.
	const MODES: PresentationMode[] = ['reading', 'source'];
	let presentationMode = $state<PresentationMode>('reading');

	// This route installs no probe surface, so `trackParityDocument` is the only thing putting
	// its document under the e2e teardown parity net.
	let editor = $state<ReturnType<typeof Editor>>();
	trackParityDocument(() => editor);
</script>

<div class="changelog aragonite-editor-theme">
	<header class="changelog-header">
		<span class="changelog-title">aragonite</span>
		<span class="changelog-tag">changelog</span>
		<span class="changelog-hint">Mod+F to search</span>
		<div class="changelog-modes" role="group" aria-label="Presentation mode">
			{#each MODES as mode (mode)}
				<button
					type="button"
					class="changelog-mode"
					class:active={presentationMode === mode}
					data-mode={mode}
					onclick={() => (presentationMode = mode)}
				>
					{mode}
				</button>
			{/each}
		</div>
		<a class="changelog-link" href={resolve('/')}>showcase</a>
	</header>
	<div class="changelog-editor">
		<Editor
			bind:this={editor}
			source={CHANGELOG_DOCUMENT}
			plugins={changelogPlugins}
			{presentationMode}
		/>
	</div>
</div>

<style>
	.changelog {
		width: 100vw;
		height: 100vh;
		display: flex;
		flex-direction: column;
		/* The wrapper carries the theme tokens, so the page chrome matches the editor. */
		background: var(--color-bg, #1b1c21);
		color: var(--color-text, #d6d9e0);
	}
	.changelog-header {
		flex: 0 0 auto;
		display: flex;
		align-items: baseline;
		gap: 0.6rem;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--color-ui-muted, #a4a4a4);
		font-family: var(--font-editor, ui-monospace, monospace);
	}
	.changelog-title {
		font-size: 1.1rem;
		font-weight: 600;
	}
	.changelog-tag {
		font-size: 0.85rem;
		color: var(--color-text-muted, #aaaaaa);
	}
	.changelog-hint {
		font-size: 0.8rem;
		color: var(--color-text-muted, #aaaaaa);
	}
	.changelog-modes {
		margin-left: auto;
		display: inline-flex;
		gap: 2px;
		padding: 2px;
		border: 1px solid var(--color-ui-muted, #a4a4a4);
		border-radius: 6px;
	}
	.changelog-mode {
		font-family: inherit;
		font-size: 0.8rem;
		padding: 0.1rem 0.55rem;
		color: var(--color-text-muted, #aaaaaa);
		background: transparent;
		border: none;
		border-radius: 4px;
		cursor: pointer;
	}
	.changelog-mode.active {
		color: var(--color-text-primary, #fff);
		background: var(--color-bg-secondary, rgba(128, 128, 128, 0.18));
	}
	.changelog-link {
		font-size: 0.85rem;
		color: var(--color-accent, #567b67);
	}
	.changelog-editor {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
	}
</style>
