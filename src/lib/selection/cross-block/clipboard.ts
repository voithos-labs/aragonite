/**
 * The cross-block branch of copy and cut, shared by every editable block and the editor root:
 * each block keeps its own single-block logic and delegates the cross-block case here, a cell
 * rectangle included. The boolean return lets callers keep their own fall-through.
 */

import type { DocumentGetter } from '../../editor-keys';
import type { CrossBlockHandlers } from './dispatch';
import type { SelectionState } from '../selection-state.svelte';
import { collectCrossBlockText } from '../clipboard-text';
import { gridClipboard } from '../grid-selection';
import { coverRange, rangeCoverage } from '../range-coverage';

export interface CrossBlockClipboardDeps {
	selection: SelectionState;
	getDoc: DocumentGetter;
	crossBlock: CrossBlockHandlers;
}

export function writeCrossBlockCopy(e: ClipboardEvent, deps: CrossBlockClipboardDeps): boolean {
	const { selection } = deps;
	if (!selection.isCrossBlock || !selection.anchor || !selection.focus) return false;
	e.preventDefault();
	const doc = deps.getDoc();
	const coverage = rangeCoverage(doc, coverRange(doc, selection.anchor, selection.focus));
	const cells = coverage.grid && gridClipboard(doc, coverage.grid);
	e.clipboardData?.setData('text/plain', cells ? cells.text : collectCrossBlockText(doc, coverage));
	// A rectangle of cells also goes on as an HTML table, which spreadsheets read.
	if (cells) e.clipboardData?.setData('text/html', cells.html);
	return true;
}

export async function writeCrossBlockCut(
	e: ClipboardEvent,
	deps: CrossBlockClipboardDeps
): Promise<boolean> {
	if (!writeCrossBlockCopy(e, deps)) return false;
	// Clipboard written synchronously above, so the cut survives an interrupted delete.
	await deps.crossBlock.performCrossBlockCut();
	return true;
}
