// Anchors the state cross-block up front so a keyboard-extend walk runs without a DOM caret;
// the element argument is only read on cross-block entry.

import { createSelectionState } from '../../selection/selection-state.svelte';
import type { Document } from '../../core/nodes';
import type { SelectionState } from '../../selection/selection-state.svelte';
import type { KeyboardExtendContext } from '../../selection/keyboard-extend';
import { defaultGrammarView } from '#lib/schema/editor-grammar.js';
import { testCaretWriter } from '#lib/test/harness/caret-writer.js';

export function stateAt(doc: Document, path: number[]) {
	const s = createSelectionState({ getDoc: () => doc });
	s.enterCrossBlock({ path: path.slice(), offset: 0 }, { path: path.slice(), offset: 0 });
	return s;
}

export const el = () => document.createElement('div');

/** The keyboard extend's context over `doc`, with the default grammar in source mode and the test caret writer. */
export function extendCtx(selection: SelectionState, doc: Document): KeyboardExtendContext {
	return {
		selection,
		caretWriter: testCaretWriter,
		getDoc: () => doc,
		reading: { grammar: defaultGrammarView, mode: () => 'source' },
		caretLanding: { restore: async () => 'applied', showSelectionEnd: async () => {} }
	};
}
