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
	import DebugPanel from './debug-panel/DebugPanel.svelte';

	let source = $state(DEFAULT_CONTENT);
	let editor: ReturnType<typeof Editor>;
	let opsLogTick = $state(0);

	onMount(() => {
		applyTheme(DEFAULT_THEME);
	});

	$effect(() => {
		if (typeof window === 'undefined' || !editor) return;
		const log = editor.getOperationsLog?.();
		if (!log) return;
		const unsub = log.subscribe(() => {
			opsLogTick += 1;
		});
		return () => unsub();
	});

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
			dumpSelection: () => dumpSelection(editor.getSelectionState()),
			dumpInlineTree: () => {
				const sel = editor.getSelectionState();
				if (!sel?.anchor) return '';
				const doc = parse(editor.getSource());
				const blockIdx = sel.anchor.path[0];
				const node = doc.children[blockIdx];
				if (!node || !isProseKind(node.kind)) return '';
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
		rawSource={source}
		onRawSourceChange={(v) => (source = v)}
		getCst={() => dumpTree(parse(source))}
		getSelection={() => dumpSelection(editor?.getSelectionState() ?? null)}
		getUndoStack={() => {
			const stack = editor?.getUndoStack?.();
			return stack ? dumpUndoStack(stack) : '(editor not ready)';
		}}
		getInlineTree={() => {
			if (!editor) return '';
			const sel = editor.getSelectionState();
			if (!sel?.anchor) return '';
			const doc = parse(source);
			const blockIdx = sel.anchor.path[0];
			const node = doc.children[blockIdx];
			if (!node || !isProseKind(node.kind)) return '';
			const range = getContentRange(node);
			const inline = parseInline(node.raw, range.start, range.end);
			return dumpInlineTree(inline);
		}}
		getOpsLog={() => {
			const log = editor?.getOperationsLog?.();
			return log ? dumpOperationsLog(log) : '';
		}}
		{opsLogTick}
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
