<script lang="ts">
	import { Editor, type PresentationMode } from '$lib';
	import { HARNESS_SHOWCASE_CONTENT } from '$lib/e2e/test-content';
	import type { KeybindingOverride } from '$lib/schema/keybinding-overrides';
	import DebugPanel from '../../debug-panel/DebugPanel.svelte';
	import { createPanelState } from '../../debug-panel/panel-state.svelte';
	import { createDebugPanelFeed } from '../../debug-panel/panel-feed.svelte';
	import SelectionToolbar from './SelectionToolbar.svelte';
	import { harnessPasteImage, installTestProbes } from './test-probes';
	import { trackParityDocument } from '../../parity-documents.svelte';

	let source = $state(HARNESS_SHOWCASE_CONTENT);
	let keybindings = $state<KeybindingOverride[] | undefined>(undefined);
	// $state so the {#key} remount on toggle re-points the test probes and debug
	// panel at the new editor instance (bind:this reassigns it).
	let editor = $state<ReturnType<typeof Editor>>();

	// `?dragHandles=false` starts with the hover drag handle disabled. blockDragHandles is
	// set-once-at-mount, so the header checkbox remounts the editor via {#key}, carrying
	// the live content across so edits survive.
	let dragHandlesOn = $state(
		typeof window === 'undefined' ||
			new URLSearchParams(window.location.search).get('dragHandles') !== 'false'
	);

	function toggleDragHandles() {
		if (editor) source = editor.getSource();
		dragHandlesOn = !dragHandlesOn;
	}

	// The prop is set-once at mount, so the opt-in is a URL param and the per-image response
	// is swapped behind this stable function. Off by default — that is the no-hook arm.
	const onPasteImage =
		typeof window !== 'undefined' &&
		new URLSearchParams(window.location.search).get('imagePaste') === 'on'
			? harnessPasteImage
			: undefined;

	// `?header=on` mounts a host header inside the editor's scroll container. Off by
	// default: a preamble shifts every block's geometry, which specs across the suite
	// measure. Its toggle lives in the page header, OUTSIDE the scroll container, because
	// clicking a control inside it would scroll the very position under test.
	const headerOn =
		typeof window !== 'undefined' &&
		new URLSearchParams(window.location.search).get('header') === 'on';
	let headerTall = $state(false);

	// `?paddedList=on` reproduces the documented host layout that widens and pads the block
	// list itself, so the visible side gutter reports the LIST as the click target rather
	// than the editor root.
	const paddedListOn =
		typeof window !== 'undefined' &&
		new URLSearchParams(window.location.search).get('paddedList') === 'on';

	// `?searchAnchor=on` mounts a fixed pane OUTSIDE `.aragonite-editor-theme` and hands it to
	// the editor as the find/replace bar's home. Off by default: the pane and its controls
	// would overlay geometry the rest of the suite measures.
	const searchAnchorOn =
		typeof window !== 'undefined' &&
		new URLSearchParams(window.location.search).get('searchAnchor') === 'on';
	let searchAnchorEl = $state<HTMLElement>();
	let anchorAttached = $state(true);
	let editorTheme = $state('dark');

	// `?presentationMode=…` starts in that mode; the prop reads live, so the header
	// toggles need no remount (unlike blockDragHandles).
	const PARAM_MODES: PresentationMode[] = ['reading', 'preview-block', 'preview-inline', 'live'];
	let presentationMode = $state<PresentationMode>(
		(typeof window !== 'undefined' &&
			(PARAM_MODES.find(
				(m) => m === new URLSearchParams(window.location.search).get('presentationMode')
			) as PresentationMode | undefined)) ||
			'source'
	);

	// The testids are pinned by the presentation e2e.
	const PRESENTATION_TOGGLES: { mode: PresentationMode; testid: string; label: string }[] = [
		{ mode: 'reading', testid: 'presentation-toggle', label: 'Reading mode' },
		{ mode: 'preview-block', testid: 'preview-block-toggle', label: 'Block preview' },
		{ mode: 'preview-inline', testid: 'preview-inline-toggle', label: 'Inline preview' },
		{ mode: 'live', testid: 'live-toggle', label: 'Live mode' }
	];

	// Records to a page-scoped sink instead of opening a window. Wired ONLY in reading
	// mode: onLinkActivate REPLACES the default open-in-tab, so wiring it in source mode
	// would swallow the native activation the link-clickability specs assert.
	function recordLinkActivation(url: string) {
		((window as unknown as { __linkActivations?: string[] }).__linkActivations ??= []).push(url);
	}

	const panel = createPanelState();
	const panelFeed = createDebugPanelFeed(() => editor);

	trackParityDocument(() => editor);

	$effect(() => {
		if (!editor) return;
		installTestProbes({
			editor,
			setSource: (md) => {
				source = md;
			},
			setKeybindings: (overrides) => {
				keybindings = overrides;
			},
			setPresentationMode: (mode) => {
				presentationMode = mode;
			}
		});
	});
</script>

<!-- The host chrome a consumer mounts in the header slot; its link follows the page's
     link behaviour, not the editor's modifier-click policy. -->
{#snippet documentHero()}
	<div class="demo-hero" data-testid="harness-header" style:height={headerTall ? '240px' : '80px'}>
		<input
			class="demo-hero-title"
			data-testid="hero-title"
			aria-label="Document title"
			value="Untitled document"
		/>
		<!-- A contenteditable title is the likelier hero shape, and the one that puts a
		     native caret inside the editor root. -->
		<div
			class="demo-hero-note"
			data-testid="hero-note"
			contenteditable="true"
			role="textbox"
			aria-label="Document note"
			tabindex="0"
		>
			A note in the host's chrome
		</div>
		<a href="#hero-link" data-testid="hero-link">#tag</a>
	</div>
{/snippet}

<div class="test-harness aragonite-editor-theme">
	<header class="demo-header">
		<div class="demo-heading">
			<h1 class="demo-title">aragonite</h1>
			<p class="demo-note">
				Live demo of the CST block editor. The debug panel on the right inspects the syntax tree,
				selection, undo stack, and operations log as you type.
			</p>
		</div>
		<label class="demo-toggle">
			<input type="checkbox" checked={dragHandlesOn} onchange={toggleDragHandles} />
			Drag handles
		</label>
		{#if headerOn}
			<button
				type="button"
				class="demo-btn"
				data-testid="header-height-toggle"
				onclick={() => (headerTall = !headerTall)}
			>
				Header: {headerTall ? 'tall' : 'short'}
			</button>
			<!-- The same field mounted OUTSIDE the editor root: the control that says
			     whether a chord result is about the slot or about text fields at large. -->
			<input
				class="demo-btn"
				data-testid="outside-title"
				aria-label="Outside title"
				value="Outside the editor"
			/>
		{/if}
		{#each PRESENTATION_TOGGLES as toggle (toggle.mode)}
			<label class="demo-toggle">
				<input
					type="checkbox"
					data-testid={toggle.testid}
					checked={presentationMode === toggle.mode}
					onchange={() =>
						(presentationMode = presentationMode === toggle.mode ? 'source' : toggle.mode)}
				/>
				{toggle.label}
			</label>
		{/each}
	</header>
	<div class="demo-body">
		<div class="editor-slot" class:padded-list={paddedListOn}>
			{#key dragHandlesOn}
				<Editor
					bind:this={editor}
					{source}
					blockDragHandles={dragHandlesOn}
					{keybindings}
					{presentationMode}
					onLinkActivate={presentationMode === 'reading' ? recordLinkActivation : undefined}
					{onPasteImage}
					header={headerOn ? documentHero : undefined}
					theme={editorTheme}
					searchBarAnchor={anchorAttached ? searchAnchorEl : null}
				/>
			{/key}
			<SelectionToolbar {editor} />
		</div>
		<DebugPanel {panel} {...panelFeed} />
	</div>
</div>

{#if searchAnchorOn}
	<!-- Deliberately outside `.aragonite-editor-theme`: a themed ancestor here would resolve
	     the bar's tokens for it and hide a seam that forgot to carry its own scope. -->
	<div class="anchor-pane" data-testid="search-anchor" bind:this={searchAnchorEl}></div>
	<div class="anchor-controls">
		<button
			type="button"
			data-testid="anchor-toggle"
			onclick={() => (anchorAttached = !anchorAttached)}
		>
			Anchor: {anchorAttached ? 'on' : 'off'}
		</button>
		<button
			type="button"
			data-testid="theme-toggle"
			onclick={() => (editorTheme = editorTheme === 'dark' ? 'light' : 'dark')}
		>
			Theme: {editorTheme}
		</button>
	</div>
{/if}

<style>
	/* Positioned, so the bar's own absolute placement resolves against the pane — the
	   consumer side of "the anchor is the box". */
	.anchor-pane {
		position: fixed;
		top: 8px;
		right: 8px;
		width: 420px;
		height: 44px;
	}
	.anchor-controls {
		position: fixed;
		bottom: 8px;
		right: 8px;
		display: flex;
		gap: 6px;
	}
	.test-harness {
		width: 100vw;
		height: 100vh;
		display: flex;
		flex-direction: column;
	}
	.demo-header {
		flex: 0 0 auto;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--color-ui-muted, #a4a4a4);
	}
	.demo-heading {
		min-width: 0;
	}
	.demo-toggle {
		flex: 0 0 auto;
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.85rem;
		font-family: var(--font-editor, ui-monospace, monospace);
		color: var(--color-text-secondary, #888);
		cursor: pointer;
		user-select: none;
		white-space: nowrap;
	}
	.demo-toggle input {
		cursor: pointer;
		margin: 0;
	}
	.demo-btn {
		flex: 0 0 auto;
		font-size: 0.85rem;
		font-family: var(--font-editor, ui-monospace, monospace);
		color: var(--color-text-secondary, #888);
		background: var(--color-bg-secondary, rgba(128, 128, 128, 0.12));
		border: 1px solid var(--color-ui-muted, #a4a4a4);
		border-radius: 4px;
		padding: 0.25rem 0.6rem;
		cursor: pointer;
		white-space: nowrap;
	}
	.demo-hero {
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 0.35rem;
		overflow: hidden;
		box-sizing: border-box;
		padding: 0.5rem 0;
		border-bottom: 1px solid var(--color-ui-muted, #a4a4a4);
	}
	.demo-hero-title {
		font-size: 1.6rem;
		font-weight: 600;
	}
	.demo-title {
		margin: 0;
		font-size: 1.1rem;
		font-weight: 600;
		font-family: var(--font-editor, ui-monospace, monospace);
	}
	.demo-note {
		margin: 0.25rem 0 0;
		font-size: 0.85rem;
		color: var(--color-text-secondary, #888);
	}
	.demo-body {
		flex: 1;
		display: flex;
		min-height: 0;
	}
	.editor-slot {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
	}
	/* Puts the visible side gutter on the LIST rather than the root — the host layout the
	   dead-space gesture has to claim through. */
	.padded-list :global(.editor > .block-list) {
		width: 100%;
		padding: 0 24px;
	}
</style>
