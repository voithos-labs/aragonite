/**
 * The panel's live wiring, as a `DebugPanel` prop bundle both mounting routes spread.
 * `getEditor` is a getter, never a value: the editor instance is reassigned by
 * `bind:this` (and by a `{#key}` remount), so a captured value goes stale.
 */

import type { Editor } from '$lib';
import { parse } from '$lib/core/parser';
import {
	dumpTree,
	dumpUndoStack,
	dumpOperationsLog,
	dumpInteractionTrace
} from '$lib/debug/inspect';
import { interactionTraceSnapshot } from '$lib/debug/interaction-trace';
import { dumpFocusedInlineTree, liveSelectionText } from './panel-sections';

type EditorInstance = ReturnType<typeof Editor>;

export function createDebugPanelFeed(getEditor: () => EditorInstance | undefined) {
	// Bumped by editor ops AND native selectionchange: without the selectionchange half,
	// clicking in a block moves the caret with no Svelte signal, so the panel never refreshes.
	let tick = $state(0);

	$effect(() => {
		const log = getEditor()?.__test.getOperationsLog?.();
		if (!log) return;
		const unsub = log.subscribe(() => {
			tick += 1;
		});
		return () => unsub();
	});

	$effect(() => {
		if (typeof document === 'undefined') return;
		const onSelectionChange = () => {
			tick += 1;
		};
		document.addEventListener('selectionchange', onSelectionChange);
		return () => document.removeEventListener('selectionchange', onSelectionChange);
	});

	// MUST NOT feed back into the `source` prop: Editor re-initializes from source
	// changes, which would wipe undo / selection / CST on every op.
	const liveSource = $derived.by(() => {
		void tick;
		return getEditor()?.getSource() ?? '';
	});

	return {
		get rawSource() {
			return liveSource;
		},
		get opsLogTick() {
			return tick;
		},
		// LIVE first: the panel's job is the state a reparse cannot express (a live-kind-vs-raw
		// desync, a transient block the serializer trims). Where the two views differ IS the bug.
		getCst: () => {
			const reparse = `--- REPARSE OF getSource() ---\n${dumpTree(parse(liveSource))}`;
			const editor = getEditor();
			if (!editor) return reparse;
			return `--- LIVE ---\n${dumpTree(editor.__test.getDocument())}\n\n${reparse}`;
		},
		getSelection: () => {
			void tick;
			return liveSelectionText(getEditor());
		},
		getUndoStack: () => {
			void tick;
			const stack = getEditor()?.__test?.getUndoStack?.();
			return stack ? dumpUndoStack(stack) : '(editor not ready)';
		},
		getInlineTree: () => {
			// tick read FIRST: if the editor is undefined on the first evaluation, the early
			// return below would skip the signal read and the derived would never subscribe.
			void tick;
			if (!getEditor()) return '';
			return dumpFocusedInlineTree(liveSource);
		},
		getOpsLog: () => {
			const log = getEditor()?.__test?.getOperationsLog?.();
			return log ? dumpOperationsLog(log) : '';
		},
		getTrace: () => {
			// The section's expand arms the recorder (DebugPanel.toggleTrace).
			void tick;
			return dumpInteractionTrace(interactionTraceSnapshot());
		}
	};
}
