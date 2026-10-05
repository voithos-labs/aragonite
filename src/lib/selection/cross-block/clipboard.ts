/**
 * Copy and cut for a range across blocks, a cell rectangle included, as one `ClipboardArm` every
 * editable block and the editor root share: its copy writes the range's text, and its removal is
 * the one a range delete runs.
 */

import type { DocumentGetter } from '../../editor-keys';
import type { ClipboardArm } from '../../components/blocks/editable-surface';
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

export function crossBlockClipboardArm(deps: CrossBlockClipboardDeps): ClipboardArm<null> {
	return {
		copy: (e) => (copyCrossBlock(e, deps) ? { held: null } : null),
		remove: () => deps.crossBlock.performCrossBlockCut()
	};
}

function copyCrossBlock(e: ClipboardEvent, deps: CrossBlockClipboardDeps): boolean {
	const { selection } = deps;
	if (!selection.isCrossBlock || !selection.anchor || !selection.focus) return false;
	const doc = deps.getDoc();
	const coverage = rangeCoverage(doc, coverRange(doc, selection.anchor, selection.focus));
	const cells = coverage.grid && gridClipboard(doc, coverage.grid);
	e.clipboardData?.setData('text/plain', cells ? cells.text : collectCrossBlockText(doc, coverage));
	// A rectangle of cells also goes on as an HTML table, which spreadsheets read.
	if (cells) e.clipboardData?.setData('text/html', cells.html);
	return true;
}
