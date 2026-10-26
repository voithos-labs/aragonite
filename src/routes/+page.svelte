<script module lang="ts">
	import { DEMO_PLUGINS, DEMO_HIGHLIGHT_OCCURRENCES, DEMO_TAGS } from './demo-plugins';

	// The prop is the enablement set, so the toggle is the plugin's presence in the array.
	const WITHOUT_OCCURRENCES = DEMO_PLUGINS.filter((unit) => unit !== DEMO_HIGHLIGHT_OCCURRENCES);
</script>

<script lang="ts">
	import { resolve } from '$app/paths';
	import { Editor } from '#lib/svelte.js';
	import SHOWCASE_DOCUMENT from '../../examples/showcase/showcase-content.md?raw';
	import '../../examples/showcase/tag-marks.css';
	import { untrack } from 'svelte';
	import { INITIAL_STATE, showsSelectionMenu } from '../../examples/showcase/controls';
	import { STORED_THEME_SCRIPT, readTheme, toggleTheme } from '../../examples/showcase/theme';
	import {
		mountShowcaseBar,
		type ShowcaseBar,
		type ShowcaseBarState,
		type ToggleKey
	} from '../../examples/showcase/top-bar';
	import '../../examples/showcase/showcase-bar.css';
	import { trackParityDocument } from './parity-documents.svelte';
	import DebugPanel from './debug-panel/DebugPanel.svelte';
	import InsertToolbar from './InsertToolbar.svelte';
	import { createPanelState } from './debug-panel/panel-state.svelte';
	import { createDebugPanelFeed } from './debug-panel/panel-feed.svelte';
	import { demoPasteImage, resolveDemoImageUrl } from '../../examples/showcase/image-store';

	// Props that can change while the editor runs: the toggles set these in place, no remount.
	let presentationMode = $state(INITIAL_STATE.presentationMode);
	let theme = $state(readTheme());

	// The showcase installs no test probes, so `trackParityDocument` is the only thing putting
	// its container-heavy document under the teardown parity check.
	let editor = $state<ReturnType<typeof Editor>>();
	trackParityDocument(() => editor);

	// blockDragHandles and the plugin set are both fixed at mount, so their toggles remount the
	// editor through {#key}, passing the current content across so a visitor's edits survive.
	let source = $state(SHOWCASE_DOCUMENT);
	let dragHandles = $state(INITIAL_STATE.dragHandles);
	let occurrences = $state(INITIAL_STATE.occurrences);
	let selectionMenu = $state(INITIAL_STATE.selectionMenu);
	// In-body tags are a consumer's plugin, not one of ours: the showcase runs them beside the
	// bundled tour so a `#tag` can be tried against everything else.
	const showcasePlugins = $derived([
		...(occurrences ? DEMO_PLUGINS : WITHOUT_OCCURRENCES),
		DEMO_TAGS
	]);

	const TOGGLE: Partial<Record<ToggleKey, () => void>> = {
		theme: () => (theme = toggleTheme(theme)),
		dragHandles: () => {
			if (editor) source = editor.getSource();
			dragHandles = !dragHandles;
		},
		selectionMenu: () => (selectionMenu = !selectionMenu),
		occurrences: () => {
			if (editor) source = editor.getSource();
			occurrences = !occurrences;
		},
		debugPanel: () => panel.toggle()
	};

	// Kept here rather than inside the panel, so the header button and the panel's own
	// Ctrl+Shift+D drive one state.
	const panel = createPanelState();
	const panelFeed = createDebugPanelFeed(() => editor);

	const barState = $derived<ShowcaseBarState>({
		mode: presentationMode,
		pressed: {
			theme: theme === 'dark',
			dragHandles,
			selectionMenu,
			occurrences,
			debugPanel: panel.open
		}
	});

	function mountBar(header: HTMLElement) {
		const bar: ShowcaseBar = mountShowcaseBar(
			header,
			{
				changelogHref: resolve('/changelog'),
				tools: ['debugPanel'],
				onMode: (mode) => (presentationMode = mode),
				onToggle: (key) => TOGGLE[key]?.(),
				editor: () => editor
			},
			untrack(() => barState)
		);
		$effect(() => bar.update(barState));
		return () => bar.destroy();
	}
</script>

<div class="showcase aragonite-editor-theme" data-editor-theme={theme}>
	<!-- Padded past the open debug panel, which is fixed over the right edge. -->
	<header
		class="showcase-header"
		style:padding-right={panel.open ? `${panel.width}px` : undefined}
		{@attach mountBar}
	></header>
	<!-- Both toolbars belong to live mode, where the document is edited as it looks; the
	     markdown-first modes stay bare. -->
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
				onPasteImage={demoPasteImage}
				resolveImageUrl={resolveDemoImageUrl}
				{presentationMode}
				linkClick="plain"
				selectionToolbar={showsSelectionMenu(presentationMode, selectionMenu)}
				{theme}
			/>
		{/key}
	</div>
	<DebugPanel {panel} {...panelFeed} />
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- a constant of ours, not user content -->
	{@html STORED_THEME_SCRIPT}
</div>

<style>
	.showcase {
		width: 100vw;
		height: 100vh;
		display: flex;
		flex-direction: column;
		/* The wrapper holds the theme tokens, so the page around the editor switches with it. */
		background: var(--color-bg, #2c2c2a);
		color: var(--color-text-secondary, #cfcfca);
		/* The host app's two typefaces: proportional for the text, and code that stays monospace
		   whatever the text face is. Set on the wrapper, which is where a consumer sets them. */
		--font-editor: 'Inter', system-ui, sans-serif;
		--font-code: 'JetBrains Mono', ui-monospace, monospace;
		font-family: var(--font-ui, system-ui, sans-serif);
	}
	/* The scroll container spans the window so its margins are the editor's own empty space,
	   where a drag can start; the reading column is the root's padding. */
	.showcase-editor {
		flex: 1;
		width: 100%;
		min-width: 0;
		min-height: 0;
	}
	.showcase-editor :global(.editor) {
		box-sizing: border-box;
		padding-left: max(1rem, calc((100% - 1000px) / 2));
		padding-right: max(1rem, calc((100% - 1000px) / 2));
	}
	/* The library paints the overlay's geometry and leaves its color to the host page. */
	.showcase-editor :global(.decoration-overlay.hl-occurrence) {
		background: rgba(250, 204, 21, 0.18);
	}
</style>
