/**
 * Shared cross-block copy/cut prologue for block clipboard handlers. Each
 * surface (text, code, table cell) owns its intra-block copy/cut logic but
 * delegates the cross-block branch here. The boolean return lets callers keep
 * their own fall-through (e.g. table cells fall through to native copy).
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
	// Clipboard is written synchronously above, so the cut survives even if the delete is interrupted.
	await deps.crossBlock.performCrossBlockDeleteFromEvent();
	return true;
}
