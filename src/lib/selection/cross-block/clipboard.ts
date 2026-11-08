/**
 * Copy and cut for a range the editor holds, a cell rectangle included, as one `ClipboardArm` every
 * editable block and the editor root share: its copy is the range's, and its removal is the one a
 * range delete runs.
 */

import type { DocumentGetter } from '../../editor-keys';
import type { ClipboardArm } from '../../components/blocks/editable/clipboard-step';
import type { CrossBlockHandlers } from './dispatch';
import type { SelectionState } from '../selection-state.svelte';
import { gridClipboard } from '../grid-selection';
import { coverRange, rangeCoverage } from '../range-coverage';
import { rangeClipboard } from '../range-clipboard';

export interface CrossBlockClipboardDeps {
	selection: SelectionState;
	getDoc: DocumentGetter;
	crossBlock: CrossBlockHandlers;
}

export function crossBlockClipboardArm(deps: CrossBlockClipboardDeps): ClipboardArm<null> {
	return {
		copy: () => {
			const { selection } = deps;
			if (!selection.ownsRange || !selection.anchor || !selection.focus) return null;
			const doc = deps.getDoc();
			const coverage = rangeCoverage(doc, coverRange(doc, selection.anchor, selection.focus));
			// A rectangle of cells also goes on as an HTML table, which spreadsheets read.
			const cells = coverage.grid && gridClipboard(doc, coverage.grid);
			const write = cells
				? { text: cells.text, html: cells.html }
				: (rangeClipboard(deps.crossBlock.bytes, coverage, deps.crossBlock.reading) ?? {
						text: ''
					});
			return { write, held: null };
		},
		remove: () => deps.crossBlock.performCrossBlockCut()
	};
}
