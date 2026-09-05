// Anchors the state cross-block up front so a keyboard-extend walk runs without a DOM caret;
// the element argument is only read on cross-block entry.

import { createSelectionState } from '../../selection/selection-state.svelte';
import type { Document } from '../../core/nodes';

export function stateAt(doc: Document, path: number[]) {
	const s = createSelectionState({ getDoc: () => doc });
	s.enterCrossBlock({ path: path.slice(), offset: 0 }, { path: path.slice(), offset: 0 });
	return s;
}

export const el = () => document.createElement('div');
