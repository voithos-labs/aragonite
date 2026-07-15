<script lang="ts">
	import { onMount } from 'svelte';
	import { Editor } from '$lib';
	import { parse } from '$lib/core/parser';
	import { applyTheme, DEFAULT_THEME, currentThemeType } from './theme';
	import {
		dumpTree,
		dumpUndoStack,
		dumpInlineTree,
		dumpOperationsLog,
		dumpInteractionTrace
	} from '$lib/debug/inspect';
	import { interactionTraceSnapshot } from '$lib/debug/interaction-trace';
	import { parseInline, getContentRange, isProseKind } from '$lib/core/inline';
	import { isBlockNode, nodeAt } from '$lib/tree-operations/node-ops';
	import { SHOWCASE_CONTENT } from '$lib/e2e/test-content';
	import type { KeybindingOverride } from '$lib/schema/keybinding-overrides';
	import DebugPanel from './debug-panel/DebugPanel.svelte';
	import SelectionToolbar from './SelectionToolbar.svelte';
	import { installTestProbes, getFocusedBlockPath, liveSelectionText } from './test-probes';

	let source = $state(SHOWCASE_CONTENT);
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
