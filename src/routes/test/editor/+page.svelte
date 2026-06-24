<script lang="ts">
	import { onMount } from 'svelte';
	import { Editor } from '$lib';
	import { parse } from '$lib/core/parser';
	import { applyTheme, DEFAULT_THEME, currentThemeType } from './theme';
	import { dumpTree, dumpUndoStack, dumpInlineTree, dumpOperationsLog } from '$lib/debug/inspect';
	import { parseInline, getContentRange, isProseKind } from '$lib/core/inline';
	import { isBlockNode, nodeAt } from '$lib/tree-operations/node-ops';
	import { SHOWCASE_CONTENT } from '$lib/e2e/test-content';
	import type { KeybindingOverride } from '$lib/schema/keybinding-overrides';
	import DebugPanel from './debug-panel/DebugPanel.svelte';
	import { installTestProbes, getFocusedBlockPath, liveSelectionText } from './test-probes';

	let source = $state(SHOWCASE_CONTENT);
	let keybindings = $state<KeybindingOverride[] | undefined>(undefined);
	let editor: ReturnType<typeof Editor>;

	// Test-only set-once toggle: `?dragHandles=false` mounts the editor with the
	// hover drag handle disabled so the reorder-handle e2e can cover the off path.
	const blockDragHandles =
		typeof window === 'undefined' ||
		new URLSearchParams(window.location.search).get('dragHandles') !== 'false';

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
		<h1 class="demo-title">aragonite</h1>
		<p class="demo-note">
			Live demo of the CST block editor. The debug panel on the right inspects the syntax tree,
			selection, undo stack, and operations log as you type.
		</p>
	</header>
	<div class="demo-body">
		<div class="editor-slot">
			<Editor
				bind:this={editor}
				{source}
				{blockDragHandles}
				{keybindings}
				theme={$currentThemeType}
			/>
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
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--color-ui-muted, #a4a4a4);
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
