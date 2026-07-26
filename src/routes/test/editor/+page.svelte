<script lang="ts">
	import { Editor, type PresentationMode } from '$lib';
	import { parse } from '$lib/core/parser';
	import {
		dumpTree,
		dumpUndoStack,
		dumpOperationsLog,
		dumpInteractionTrace
	} from '$lib/debug/inspect';
	import { interactionTraceSnapshot } from '$lib/debug/interaction-trace';
	import { SHOWCASE_CONTENT } from '$lib/e2e/test-content';
	import type { KeybindingOverride } from '$lib/schema/keybinding-overrides';
	import DebugPanel from './debug-panel/DebugPanel.svelte';
	import SelectionToolbar from './SelectionToolbar.svelte';
	import {
		harnessPasteImage,
		installTestProbes,
		liveSelectionText,
		dumpFocusedInlineTree
	} from './test-probes';
	import { trackParityDocument } from '../../parity-documents.svelte';

	let source = $state(SHOWCASE_CONTENT);
	let keybindings = $state<KeybindingOverride[] | undefined>(undefined);
	// $state so the {#key} remount on toggle re-points the test probes and debug
	// panel at the new editor instance (bind:this reassigns it).
	let editor = $state<ReturnType<typeof Editor>>();

	// `?dragHandles=false` starts with the hover drag handle disabled (the
	// reorder-handle e2e covers the off path). The header checkbox flips it live;
	// since blockDragHandles is set-once-at-mount, the toggle remounts the editor
	// via {#key} (carrying the live content across so edits survive).
	let dragHandlesOn = $state(
		typeof window === 'undefined' ||
			new URLSearchParams(window.location.search).get('dragHandles') !== 'false'
	);

	function toggleDragHandles() {
		if (editor) source = editor.getSource();
		dragHandlesOn = !dragHandlesOn;
	}

	// `?imagePaste=on` installs the harness image-import hook. The prop is set-once
	// at mount, so the opt-in is a URL param (like `dragHandles`) and the per-image
	// response is swapped behind the stable function via `__test.imagePaste`. Off by
	// default, which is also the no-hook arm of the contract.
	const onPasteImage =
		typeof window !== 'undefined' &&
		new URLSearchParams(window.location.search).get('imagePaste') === 'on'
			? harnessPasteImage
			: undefined;

	// `?header=on` mounts a host header inside the editor's scroll container (the
	// DocumentHero shape). Off by default: a preamble shifts every block's geometry,
	// which specs across the suite measure. Its height toggles between two values so
	// the anchor compensation has something to compensate for; the toggle control
	// lives in the page header, OUTSIDE the editor's scroll container, because
	// clicking a control inside it would scroll the very position under test.
	const headerOn =
		typeof window !== 'undefined' &&
		new URLSearchParams(window.location.search).get('header') === 'on';
	let headerTall = $state(false);

	// `?presentationMode=reading|preview-block|preview-inline` starts in that mode;
	// the header toggles flip it live (the prop reads live — no remount, unlike
	// blockDragHandles).
	const PARAM_MODES: PresentationMode[] = ['reading', 'preview-block', 'preview-inline'];
	let presentationMode = $state<PresentationMode>(
		(typeof window !== 'undefined' &&
			(PARAM_MODES.find(
				(m) => m === new URLSearchParams(window.location.search).get('presentationMode')
			) as PresentationMode | undefined)) ||
			'source'
	);

	// Each header checkbox toggles its mode against source. testids are pinned by the
	// presentation e2e.
	const PRESENTATION_TOGGLES: { mode: PresentationMode; testid: string; label: string }[] = [
		{ mode: 'reading', testid: 'presentation-toggle', label: 'Reading mode' },
		{ mode: 'preview-block', testid: 'preview-block-toggle', label: 'Block preview' },
		{ mode: 'preview-inline', testid: 'preview-inline-toggle', label: 'Inline preview' }
	];

	// Reading-mode link activation records to a page-scoped sink instead of opening a
	// window, so the presentation e2e can assert the handler fired on a plain click.
	// Wired ONLY in reading mode (below): onLinkActivate REPLACES the default
	// open-in-tab, so wiring it in source mode would swallow the native activation
	// the link-clickability specs assert.
	function recordLinkActivation(url: string) {
		((window as unknown as { __linkActivations?: string[] }).__linkActivations ??= []).push(url);
	}

	// Single reactive counter that retriggers panel getters. Bumped by BOTH
	// editor ops (via the ops-log subscriber) AND native DOM selection changes
	// (selectionchange). Without the selectionchange half, clicking in a block
	// moves the caret but no Svelte signal fires, so the inline/selection
	// sections never refresh.
	let panelTick = $state(0);

	$effect(() => {
		if (typeof window === 'undefined' || !editor) return;
		const log = editor.__test.getOperationsLog?.();
		if (!log) return;
		const unsub = log.subscribe(() => {
			panelTick += 1;
		});
		return () => unsub();
	});

	$effect(() => {
		if (typeof document === 'undefined') return;
		const onSelectionChange = () => {
			panelTick += 1;
		};
		document.addEventListener('selectionchange', onSelectionChange);
		return () => document.removeEventListener('selectionchange', onSelectionChange);
	});

	// Panel-display view of the editor's live source. MUST NOT feed back into
	// the `source` prop — Editor re-initializes from source changes, which
	// would wipe undo / selection / CST on every op.
	const liveSource = $derived.by(() => {
		void panelTick;
		return editor?.getSource() ?? source;
	});

	// The LIVE tree first, because the panel's whole job is the state a reparse
	// cannot express: a live-kind-vs-raw desync, or a transient block the serializer
	// trims. The reparse rides along as a second labeled view — when the two differ,
	// the difference IS the bug being hunted.
	function cstSection(): string {
		const reparse = `--- REPARSE OF getSource() ---\n${dumpTree(parse(liveSource))}`;
		if (!editor) return reparse;
		return `--- LIVE ---\n${dumpTree(editor.__test.getDocument())}\n\n${reparse}`;
	}

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

<!-- The host chrome a consumer mounts in the header slot: a title, a link (host
     chrome follows the page's link behaviour, not the editor's modifier-click
     policy), and a filler whose height the page-header button toggles. -->
{#snippet documentHero()}
	<div class="demo-hero" data-testid="harness-header" style:height={headerTall ? '240px' : '80px'}>
		<input
			class="demo-hero-title"
			data-testid="hero-title"
			aria-label="Document title"
			value="Untitled document"
		/>
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
		<div class="editor-slot">
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
					theme="dark"
				/>
			{/key}
			<SelectionToolbar {editor} />
		</div>
		<DebugPanel
			rawSource={liveSource}
			getCst={cstSection}
			getSelection={() => {
				void panelTick;
				return liveSelectionText(editor);
			}}
			getUndoStack={() => {
				void panelTick;
				const stack = editor?.__test?.getUndoStack?.();
				return stack ? dumpUndoStack(stack) : '(editor not ready)';
			}}
			getInlineTree={() => {
				// panelTick read FIRST — if editor is undefined on the derived's first
				// evaluation (possible during HMR re-mount or tight initial-mount
				// timing), the early return below would skip the signal read and the
				// derived would never subscribe. Reading it unconditionally makes the
				// dep registration independent of editor's ready state.
				void panelTick;
				if (!editor) return '';
				return dumpFocusedInlineTree(liveSource);
			}}
			getOpsLog={() => {
				const log = editor?.__test?.getOperationsLog?.();
				return log ? dumpOperationsLog(log) : '';
			}}
			getTrace={() => {
				// Module-global trace; refreshed on the shared panelTick. The section's
				// expand arms the recorder (DebugPanel.toggleTrace).
				void panelTick;
				return dumpInteractionTrace(interactionTraceSnapshot());
			}}
			opsLogTick={panelTick}
		/>
	</div>
</div>

<style>
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
</style>
