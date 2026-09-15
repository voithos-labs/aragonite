/**
 * The cross-block branch of copy and cut, shared by every editable block: each block keeps its
 * own single-block logic and delegates the cross-block case here. The boolean return lets
 * callers keep their own fall-through.
 */

import type { DocumentGetter } from '../../editor-keys';
import type { CrossBlockHandlers } from './dispatch';
import type { SelectionState } from '../selection-state.svelte';
import { collectCrossBlockText } from '../clipboard-text';

export interface CrossBlockClipboardDeps {
	selection: SelectionState;
	getDoc: DocumentGetter;
	crossBlock: CrossBlockHandlers;
}

export function writeCrossBlockCopy(e: ClipboardEvent, deps: CrossBlockClipboardDeps): boolean {
	const { selection } = deps;
	if (!selection.isCrossBlock || !selection.anchor || !selection.focus) return false;
	e.preventDefault();
	e.clipboardData?.setData(
		'text/plain',
		collectCrossBlockText(deps.getDoc(), selection.anchor, selection.focus)
	);
	return true;
}

export async function writeCrossBlockCut(
	e: ClipboardEvent,
	deps: CrossBlockClipboardDeps
): Promise<boolean> {
	if (!writeCrossBlockCopy(e, deps)) return false;
	// Clipboard written synchronously above, so the cut survives an interrupted delete.
	await deps.crossBlock.performCrossBlockDeleteFromEvent();
	return true;
}
