<script module lang="ts">
	import { detailsPlugin } from '$lib/plugins/details';
	import { latexPlugin } from '$lib/plugins/latex';
	import { katexRenderer } from '$lib/plugins/latex/renderer';
	import { admonitionsPlugin } from '$lib/plugins/admonitions';
	import { mermaidPlugin } from '$lib/plugins/mermaid';
	import { mermaidRenderer } from '$lib/plugins/mermaid/renderer';

	// The `?plugins=1` showcase installs the reference plugins — the set a real
	// consumer would install — through the canonical `<Editor plugins>` prop. The
	// fixture-only dogfoods (callout, memo) stay on /test/plugins with their e2e
	// batteries; see src/routes/test/plugins/README.md for the classification.
	// Without callout co-registered, admonitions claims all five `:::name` kinds.
	// Built once at module scope: the factories run once per process, and
	// importing the plugin modules is inert (registration runs only inside
	// installPlugins, which the default path never calls), so the param-less
	// `/test/editor` stays plugin-free for the batteries that share this route.
	const referencePlugins = [
		detailsPlugin(),
		latexPlugin({ renderer: katexRenderer }),
		admonitionsPlugin(),
		mermaidPlugin({ renderer: mermaidRenderer })
	];
</script>

<script lang="ts">
	import { onMount } from 'svelte';
	import { Editor } from '$lib';
	import { parse } from '$lib/core/parser';
	import { applyTheme, DEFAULT_THEME, currentThemeType } from './theme';
	import { dumpTree, dumpUndoStack, dumpInlineTree, dumpOperationsLog } from '$lib/debug/inspect';
	import { parseInline, getContentRange, isProseKind } from '$lib/core/inline';
	import { isBlockNode, nodeAt } from '$lib/tree-operations/node-ops';
	import { SHOWCASE_CONTENT, SHOWCASE_PLUGIN_CONTENT } from '$lib/e2e/test-content';
	import type { KeybindingOverride } from '$lib/schema/keybinding-overrides';
	import type { PageData } from './$types';
	import DebugPanel from './debug-panel/DebugPanel.svelte';
	import SelectionToolbar from './SelectionToolbar.svelte';
	import { installTestProbes, getFocusedBlockPath, liveSelectionText } from './test-probes';

	let { data }: { data: PageData } = $props();
	// One-time snapshot from the SSR-consistent load; the harness never re-navigates
	// client-side, so capturing the prop's initial value is the intent. Off by
	// default, so the batteries that share this route see a plugin-free editor.
	// svelte-ignore state_referenced_locally
	const pluginsOn = data.plugins;

	// svelte-ignore state_referenced_locally
	let source = $state(pluginsOn ? SHOWCASE_PLUGIN_CONTENT : SHOWCASE_CONTENT);
	let keybindings = $state<KeybindingOverride[] | undefined>(undefined);
	// $state so the {#key} remount on toggle re-points the test probes and debug
	// panel at the new editor instance (bind:this reassigns it).
	let editor = $state<ReturnType<typeof Editor>>();
	let editorSlot = $state<HTMLElement>();

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

	// Single reactive counter that retriggers panel getters. Bumped by BOTH
	// editor ops (via the ops-log subscriber) AND native DOM selection changes
	// (selectionchange). Without the selectionchange half, clicking in a block
	// moves the caret but no Svelte signal fires, so the inline/selection
	// sections never refresh.
	let panelTick = $state(0);

	onMount(() => {
		applyTheme(DEFAULT_THEME);
	});

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
		panelTick;
		return editor?.getSource() ?? source;
	});

	$effect(() => {
		if (!editor) return;
		installTestProbes({
			editor,
			setSource: (md) => {
				source = md;
			},
			setKeybindings: (overrides) => {
				keybindings = overrides;
			}
		});
	});
</script>

<div class="test-harness aragonite-editor-theme">
	<header class="demo-header">
		<div class="demo-heading">
			<h1 class="demo-title">
				aragonite{#if pluginsOn}<span class="demo-mode-badge" data-testid="plugins-mode-badge"
						>plugins</span
					>{/if}
			</h1>
			<p class="demo-note">
				Live demo of the CST block editor. The debug panel on the right inspects the syntax tree,
				selection, undo stack, and operations log as you type.
			</p>
		</div>
		<label class="demo-toggle">
			<input type="checkbox" checked={dragHandlesOn} onchange={toggleDragHandles} />
			Drag handles
		</label>
	</header>
	<div class="demo-body">
		<div class="editor-slot" bind:this={editorSlot}>
			{#key dragHandlesOn}
				<Editor
					bind:this={editor}
					{source}
					blockDragHandles={dragHandlesOn}
					{keybindings}
					theme={$currentThemeType}
					plugins={pluginsOn ? referencePlugins : undefined}
				/>
			{/key}
			<SelectionToolbar {editor} container={editorSlot} />
		</div>
		<DebugPanel
			rawSource={liveSource}
			getCst={() => dumpTree(parse(liveSource))}
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
				const path = getFocusedBlockPath();
				if (!path) return '';
				const doc = parse(liveSource);
				const node = nodeAt(doc, path);
				if (!node || !isBlockNode(node) || !isProseKind(node.kind)) return '';
				const range = getContentRange(node);
				const inline = parseInline(node.raw, range.start, range.end);
				return dumpInlineTree(inline);
			}}
			getOpsLog={() => {
				const log = editor?.__test?.getOperationsLog?.();
				return log ? dumpOperationsLog(log) : '';
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
	.demo-title {
		margin: 0;
		font-size: 1.1rem;
		font-weight: 600;
		font-family: var(--font-editor, ui-monospace, monospace);
	}
	.demo-mode-badge {
		margin-left: 0.5rem;
		padding: 0.1rem 0.4rem;
		border-radius: 0.25rem;
		font-size: 0.65rem;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		vertical-align: middle;
		color: var(--color-text-secondary, #888);
		border: 1px solid var(--color-ui-muted, #a4a4a4);
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
