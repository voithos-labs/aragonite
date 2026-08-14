<script module lang="ts">
	import { DEMO_PLUGINS, DEMO_TOC } from './../demo-plugins';

	// This route's own outline depth, declared per instance so the shared set still installs once.
	const changelogPlugins = DEMO_PLUGINS.map((entry) =>
		entry === DEMO_TOC ? { plugin: DEMO_TOC, options: { maxDepth: 3 } } : entry
	);
</script>

<script lang="ts">
	import { resolve } from '$app/paths';
	import { Editor, type PresentationMode } from '$lib';
	import { CHANGELOG_FAMILIES } from './changelog-content';
	import { trackParityDocument } from '../parity-documents.svelte';

	// One live-changeable prop is the whole demo: the same render path over the same bytes,
	// rendered or as styled source. Reading is the default — this is a document to read.
	const MODES: PresentationMode[] = ['reading', 'source'];
	let presentationMode = $state<PresentationMode>('reading');

	// The changelog ships one file per release family; the picker is a `source` prop swap.
	let familyId = $state(CHANGELOG_FAMILIES[0].id);
	const family = $derived(
		CHANGELOG_FAMILIES.find((entry) => entry.id === familyId) ?? CHANGELOG_FAMILIES[0]
	);

	// This route installs no probe surface, so `trackParityDocument` is the only thing putting
	// its document under the e2e teardown parity net.
	let editor = $state<ReturnType<typeof Editor>>();
	trackParityDocument(() => editor);
</script>

<div class="changelog aragonite-editor-theme">
	<header class="changelog-header">
		<span class="changelog-title">aragonite</span>
		<span class="changelog-tag">changelog</span>
		<div class="changelog-chips" role="group" aria-label="Release family">
			{#each CHANGELOG_FAMILIES as entry (entry.id)}
				<button
					type="button"
					class="changelog-chip changelog-family"
					class:active={entry.id === familyId}
					data-family={entry.id}
					onclick={() => (familyId = entry.id)}
				>
					{entry.id}
				</button>
			{/each}
		</div>
		<span class="changelog-hint">Mod+F to search</span>
		<div class="changelog-chips changelog-modes" role="group" aria-label="Presentation mode">
			{#each MODES as mode (mode)}
				<button
					type="button"
					class="changelog-chip changelog-mode"
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
			source={family.document}
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
		background: var(--color-surface, #1b1c21);
		color: var(--color-text-secondary, #d6d9e0);
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
	.changelog-chips {
		display: inline-flex;
		gap: 2px;
		padding: 2px;
		border: 1px solid var(--color-ui-muted, #a4a4a4);
		border-radius: var(--radius-ui, 6px);
	}
	.changelog-modes {
		margin-left: auto;
	}
	.changelog-chip {
		font-family: inherit;
		font-size: 0.8rem;
		padding: 0.1rem 0.55rem;
		color: var(--color-text-muted, #aaaaaa);
		background: transparent;
		border: none;
		border-radius: var(--radius-ui, 4px);
		cursor: pointer;
	}
	.changelog-chip.active {
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
