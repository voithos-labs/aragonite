<script module lang="ts">
	import { DEMO_PLUGINS, DEMO_HIGHLIGHT_OCCURRENCES } from './demo-plugins';

	// The prop is the enablement set, so the toggle is the plugin's presence in the array.
	const WITHOUT_OCCURRENCES = DEMO_PLUGINS.filter((unit) => unit !== DEMO_HIGHLIGHT_OCCURRENCES);
</script>

<script lang="ts">
	import { resolve } from '$app/paths';
	import { Editor, type PresentationMode } from '$lib';
	import SHOWCASE_DOCUMENT from './showcase-content.md?raw';
	import { trackParityDocument } from './parity-documents.svelte';
	import DebugPanel from './debug-panel/DebugPanel.svelte';
	import InsertToolbar from './InsertToolbar.svelte';
	import SelectionToolbar from './SelectionToolbar.svelte';
	import { createPanelState } from './debug-panel/panel-state.svelte';
	import { createDebugPanelFeed } from './debug-panel/panel-feed.svelte';

	// Live-changeable props — the toggles flip these in place, no remount.
	const MODES: PresentationMode[] = [
		'source',
		'reading',
		'preview-block',
		'preview-inline',
		'live'
	];
	let presentationMode = $state<PresentationMode>('source');
	let theme = $state<'dark' | 'light'>('dark');

	// The showcase installs no probe surface, so `trackParityDocument` is the only thing
	// putting its container-dense document under the teardown parity net.
	let editor = $state<ReturnType<typeof Editor>>();
	trackParityDocument(() => editor);

	// blockDragHandles and the plugin set are both set-once at mount, so their toggles remount
	// the editor via {#key}, carrying the live content across so a visitor's edits survive.
	let source = $state(SHOWCASE_DOCUMENT);
	let dragHandles = $state(false);
	let occurrences = $state(false);
	const showcasePlugins = $derived(occurrences ? DEMO_PLUGINS : WITHOUT_OCCURRENCES);

	function toggleDragHandles() {
		if (editor) source = editor.getSource();
		dragHandles = !dragHandles;
	}

	function toggleOccurrences() {
		if (editor) source = editor.getSource();
		occurrences = !occurrences;
	}

	// Reading mode ONLY: the editor gates handles off there, so an enabled toggle would paint an
	// active state it cannot produce. Live is an editing mode, so it keeps every affordance.
	const handlesGated = $derived(presentationMode === 'reading');

	// Owned here rather than inside the panel, so the header affordance and the panel's own
	// Ctrl+Shift+D drive one state.
	const panel = createPanelState();
	const panelFeed = createDebugPanelFeed(() => editor);

	let headerHeight = $state(0);
</script>

<div class="showcase aragonite-editor-theme" data-editor-theme={theme}>
	<header class="showcase-header" bind:clientHeight={headerHeight}>
		<span class="showcase-title">aragonite</span>
		<span class="showcase-tag">showcase</span>
		<!-- Left of the mode group's auto margin: the open debug panel is fixed to the right
		     edge and would otherwise cover the affordance that closes it. -->
		<button
			type="button"
			class="showcase-toggle"
			class:active={theme === 'light'}
			data-testid="theme-toggle"
			aria-pressed={theme === 'light'}
			onclick={() => (theme = theme === 'dark' ? 'light' : 'dark')}
		>
			light
		</button>
		<button
			type="button"
			class="showcase-toggle"
			class:active={dragHandles}
			data-testid="drag-handles-toggle"
			aria-pressed={dragHandles}
			disabled={handlesGated}
			title={handlesGated ? 'Reading mode hides the drag handles' : undefined}
			onclick={toggleDragHandles}
		>
			handles
		</button>
		<button
			type="button"
			class="showcase-toggle"
			class:active={occurrences}
			data-testid="occurrences-toggle"
			aria-pressed={occurrences}
			title="Highlight every other occurrence of the word under the caret"
			onclick={toggleOccurrences}
		>
			occurrences
		</button>
		<button
			type="button"
			class="showcase-toggle"
			class:active={panel.open}
			data-testid="debug-toggle"
			aria-pressed={panel.open}
			onclick={() => panel.toggle()}
		>
			under the hood
		</button>
		<span class="showcase-hint">Mod+F to search</span>
		<div class="showcase-modes" role="group" aria-label="Presentation mode">
			{#each MODES as mode (mode)}
				<button
					type="button"
					class="showcase-mode"
					class:active={presentationMode === mode}
					data-mode={mode}
					onclick={() => (presentationMode = mode)}
				>
					{mode}
				</button>
			{/each}
		</div>
		<a class="showcase-link" href="https://github.com/voithos-labs/aragonite/tree/main/docs">docs</a
		>
		<a class="showcase-link" href={resolve('/changelog')}>changelog</a>
	</header>
	<!-- Both toolbars are live mode's WYSIWYG affordance set; the markdown-first modes stay bare. -->
	{#if presentationMode === 'live'}
		<InsertToolbar {editor} />
	{/if}
	<div class="showcase-editor">
		{#key `${dragHandles}:${occurrences}`}
			<Editor
				bind:this={editor}
				{source}
				plugins={showcasePlugins}
				blockDragHandles={dragHandles}
				{presentationMode}
				{theme}
			/>
		{/key}
		{#if presentationMode === 'live'}
			<SelectionToolbar {editor} topInset={headerHeight} />
		{/if}
	</div>
	<DebugPanel {panel} {...panelFeed} />
</div>

<style>
	.showcase {
		width: 100vw;
		height: 100vh;
		display: flex;
		flex-direction: column;
		/* The wrapper carries the theme tokens, so the page chrome flips with the editor. */
		background: var(--color-surface, #1b1c21);
		color: var(--color-text-secondary, #d6d9e0);
	}
	.showcase-header {
		flex: 0 0 auto;
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.6rem;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--color-ui-muted, #a4a4a4);
		font-family: var(--font-editor, ui-monospace, monospace);
	}
	.showcase-title {
		font-size: 1.1rem;
		font-weight: 600;
	}
	.showcase-tag {
		font-size: 0.85rem;
		color: var(--color-text-muted, #888);
	}
	.showcase-modes {
		margin-left: auto;
		display: inline-flex;
		gap: 2px;
		padding: 2px;
		border: 1px solid var(--color-ui-muted, #a4a4a4);
		border-radius: 6px;
	}
	.showcase-mode,
	.showcase-toggle {
		font-family: inherit;
		font-size: 0.8rem;
		padding: 0.1rem 0.55rem;
		color: var(--color-text-muted, #888);
		background: transparent;
		border: none;
		border-radius: 4px;
		cursor: pointer;
		/* A pill is one word wide; wrapping its label doubles the header's row height. */
		white-space: nowrap;
	}
	.showcase-mode.active,
	.showcase-toggle.active {
		color: var(--color-text-primary, #fff);
		background: var(--color-bg-secondary, rgba(128, 128, 128, 0.18));
	}
	.showcase-toggle:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.showcase-hint {
		font-size: 0.75rem;
		color: var(--color-text-muted, #888);
	}
	.showcase-link {
		font-size: 0.85rem;
		color: var(--color-accent, #567b67);
	}
	.showcase-editor {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
	}
	/* The library paints the overlay's geometry and leaves its color to the host page. */
	.showcase-editor :global(.decoration-overlay.hl-occurrence) {
		background: rgba(250, 204, 21, 0.18);
	}

	/* Eleven controls over four rows ate a quarter of a phone screen before the document
	   got a pixel. The demo IS the document, so the chrome condenses and drops what a
	   phone cannot use. */
	@media (max-width: 640px) {
		.showcase-header {
			gap: 0.3rem 0.45rem;
			padding: 0.45rem 0.6rem;
		}
		/* No modifier key to press, and the tag is a label the title already carries. */
		.showcase-tag,
		.showcase-hint {
			display: none;
		}
		.showcase-title {
			font-size: 1rem;
		}
		.showcase-mode,
		.showcase-toggle {
			font-size: 0.7rem;
			padding: 0.1rem 0.4rem;
		}
		/* inline-flex holds the pills on one line no width can break, which is what put
		   `live` past the right edge; the group takes a row and wraps inside it instead. */
		.showcase-modes {
			margin-left: 0;
			flex: 1 0 100%;
			flex-wrap: wrap;
			justify-content: center;
		}
	}

	/* Every header control clears the thumb minimum, the links included. It costs the condensed
	   header two rows back, which is the trade: a control nobody can hit is not a saved row. */
	@media (pointer: coarse) {
		.showcase-mode,
		.showcase-toggle,
		.showcase-link {
			display: inline-flex;
			align-items: center;
			min-height: 24px;
		}
	}
</style>
