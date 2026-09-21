/**
 * The panel's live data, as a bundle of `DebugPanel` props both routes spread. `getEditor` is a
 * getter, never a value: `bind:this` reassigns the editor instance, and a `{#key}` remount
 * replaces it, so a captured value goes stale.
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
	// Bumped by editor operations and by the browser's selectionchange: without the second,
	// clicking in a block moves the caret with no Svelte signal and the panel never refreshes.
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

	// This must not feed back into the `source` prop: Editor re-initializes from a source change,
	// which would wipe the undo stack, the selection and the CST on every operation.
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
		// The live tree first: the panel's job is the state a reparse cannot show (a block whose
		// kind no longer matches its raw text, a short-lived block the serializer trims). Where
		// the two differ is the bug.
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
			// tick is read first: if the editor is undefined the first time this runs, the early
			// return below would skip the signal and this would never re-run.
			void tick;
			if (!getEditor()) return '';
			return dumpFocusedInlineTree(liveSource);
		},
		getOpsLog: () => {
			const log = getEditor()?.__test?.getOperationsLog?.();
			return log ? dumpOperationsLog(log) : '';
		},
		getTrace: () => {
			// Expanding the section is what starts the recorder (DebugPanel.toggleTrace).
			void tick;
			return dumpInteractionTrace(interactionTraceSnapshot());
		}
	};
}
