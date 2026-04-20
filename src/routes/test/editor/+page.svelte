<script lang="ts">
	import { onMount } from 'svelte';
	import Editor from '$lib/editor/components/Editor.svelte';
	import { parse } from '$lib/editor/core/parser';
	import { DEFAULT_CONTENT } from '$lib/editor/e2e/test-content';
	import { applyTheme, DEFAULT_THEME } from '$lib/theme';
	import {
		dumpTree,
		dumpSelection,
		dumpUndoStack,
		dumpInlineTree,
		dumpOperationsLog
	} from '$lib/editor/debug/inspect';
	import { parseInline, getContentRange, isProseKind } from '$lib/editor/core/inline';
	import { findBlockPathForElement } from '$lib/editor/selection/path-lookup';
	import { nodeAt } from '$lib/editor/tree-operations/node-ops';
	import DebugPanel from './debug-panel/DebugPanel.svelte';

	let source = $state(DEFAULT_CONTENT);
	let editor: ReturnType<typeof Editor>;

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
		const log = editor.getOperationsLog?.();
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

	// Path of the block containing the current native selection's start.
	// Prefers the range's container over document.activeElement so it still
	// resolves when focus has moved to the panel (e.g., after clicking a
	// section header) — the browser's last selection still points into the
	// editor's DOM.
	function getFocusedBlockPath(): number[] | null {
		if (typeof window === 'undefined') return null;
		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0) return null;
		const node = sel.getRangeAt(0).startContainer;
		const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);
		return findBlockPathForElement(el);
	}

	// Selection section string. Covers both cross-block (SelectionState) and
	// single-block (native DOM) modes — SelectionState is null-everywhere in
	// single-block by design, so dumpSelection alone would always show
	// "(no selection)" and the user would never see their live caret.
	function liveSelectionText(): string {
		const state = editor?.getSelectionState();
		if (state?.isCrossBlock && state.anchor && state.focus) {
			return dumpSelection(state);
		}
		if (typeof window === 'undefined') return '(no selection)';
		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0) return '(no selection)';
		const range = sel.getRangeAt(0);
		const startNode = range.startContainer;
		const endNode = range.endContainer;
		const startEl =
			startNode.nodeType === Node.TEXT_NODE ? startNode.parentElement : (startNode as Element);
		const endEl =
			endNode.nodeType === Node.TEXT_NODE ? endNode.parentElement : (endNode as Element);
		const startPath = findBlockPathForElement(startEl);
		const endPath = findBlockPathForElement(endEl);
		if (!startPath || !endPath) return '(no selection in editor)';
		const lines = [
			`mode=single-block${range.collapsed ? ' (caret)' : ' (range)'}`,
			`anchor=[${startPath.join(',')}] focus=[${endPath.join(',')}]`,
			`dom-offsets: start=${range.startOffset} end=${range.endOffset}`
		];
		if (!range.collapsed) {
			const selected = sel.toString();
			if (selected) lines.push(`selected=${JSON.stringify(selected)}`);
		}
		return lines.join('\n');
	}

	$effect(() => {
		if (typeof window === 'undefined' || !editor) return;

		(window as any).__test = {
			getSource: () => editor.getSource(),
			setSource: (md: string) => {
				source = md;
			},
			getBlockCount: () => {
				const doc = parse(editor.getSource());
				return doc.children.length;
			},
			getBlockKind: (index: number) => {
				const doc = parse(editor.getSource());
				return doc.children[index]?.kind ?? '';
			},
			isCrossBlockActive: () => {
				return document.querySelector('[data-cross-block]') !== null;
			},
			isCrossBlockSelection: (): boolean => {
				return editor?.getSelectionState().isCrossBlock ?? false;
			},
			getSelectionPaths: () => {
				const state = editor.getSelectionState();
				if (!state || !state.anchor || !state.focus) return null;
				return {
					anchor: { path: state.anchor.path, offset: state.anchor.offset },
					focus: { path: state.focus.path, offset: state.focus.offset }
				};
			},
			// ── Debug engine surface ──────────────────────────────────────────
			dumpTree: (opts?: Parameters<typeof dumpTree>[1]) =>
				dumpTree(parse(editor.getSource()), opts),
			dumpSelection: () => liveSelectionText(),
			dumpInlineTree: () => {
				const path = getFocusedBlockPath();
				if (!path) return '';
				const doc = parse(editor.getSource());
				const node = nodeAt(doc, path);
				if (!node || !('kind' in node) || !isProseKind(node.kind)) return '';
				const range = getContentRange(node);
				const inline = parseInline(node.raw, range.start, range.end);
				return dumpInlineTree(inline);
			},
			dumpUndoStack: (n = 10) => dumpUndoStack(editor.getUndoStack(), n),
			dumpOperationsLog: (n = 20) => dumpOperationsLog(editor.getOperationsLog(), n)
		};
	});
</script>

<div class="test-harness">
	<div class="editor-slot">
		<Editor bind:this={editor} {source} />
	</div>
	<DebugPanel
		rawSource={liveSource}
		getCst={() => dumpTree(parse(liveSource))}
		getSelection={() => {
			void panelTick;
			return liveSelectionText();
		}}
		getUndoStack={() => {
			void panelTick;
			const stack = editor?.getUndoStack?.();
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
			if (!node || !('kind' in node) || !isProseKind(node.kind)) return '';
			const range = getContentRange(node);
			const inline = parseInline(node.raw, range.start, range.end);
			return dumpInlineTree(inline);
		}}
		getOpsLog={() => {
			const log = editor?.getOperationsLog?.();
			return log ? dumpOperationsLog(log) : '';
		}}
		opsLogTick={panelTick}
	/>
</div>

<style>
	.test-harness {
		width: 100vw;
		height: 100vh;
		display: flex;
	}
	.editor-slot {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
</style>
