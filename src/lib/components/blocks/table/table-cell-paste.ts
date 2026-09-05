/**
 * Cell text ingestion for tableCell: the caret mapping that follows the sink's
 * inserted backslashes, plus the paste hooks exposed as a PasteSurface. The bytes
 * are the kind's business — every hook hands back plain spliced text and
 * `normalizeCellRaw` runs at the write sink.
 */

import { CURSOR_END } from '../../../block-component';
import { normalizeCellRaw } from '../../../schema/table-cell-raw';
import type { CstNode } from '../../../core/nodes';
import { blockNodeAt, cutRangeFromDisplay } from '../../../tree-operations/node-ops';
import { sliceTableAtRow } from '../../../tree-operations/paste/table-slice';
import { focusIndexBeforeResidue } from '../../../tree-operations/paste/focus-target';
import { replaceBlockAtParent } from '../../../tree-operations/paste/replace-block-at-parent';
import type {
	InlinePasteResult,
	PasteRange,
	PasteSeam,
	PasteSurface,
	ScopedStructuralPasteInput
} from '../../../tree-operations/paste-surfaces';

// ── Public API ─────────────────────────────────────────────────────────────

export function normalizeWhitespace(s: string): string {
	return s.replace(/\n+/g, ' ').trim();
}

/**
 * Where `offset` lands once the sink's `normalizeCellRaw` has run — defined as that
 * same pass over the prefix, so the caret cannot drift out of step with the bytes.
 */
export function escapedCellOffset(text: string, offset: number): number {
	return normalizeCellRaw(text.slice(0, offset)).length;
}

export function tableCellInlinePaste(
	node: CstNode,
	offset: number,
	text: string,
	preDelete?: PasteRange,
	seam?: PasteSeam
): InlinePasteResult {
	const cleaned = normalizeWhitespace(text);

	// The delete half crosses the join seam BEFORE the escaping stage (live-mode.md § 4.5): the
	// seam reads and writes the cell's own display bytes, and `normalizeCellRaw` still runs at the
	// sink over whatever they end up being.
	const { display: raw, offset: effectiveOffset } = cutRangeFromDisplay(
		node,
		node.raw,
		preDelete ?? { start: offset, end: offset },
		seam?.presentationMode,
		seam?.linkRef
	);

	const spliced = raw.slice(0, effectiveOffset) + cleaned + raw.slice(effectiveOffset);
	// Escaped space, because the sink escapes the whole spliced raw and not just the
	// pasted text: the insertion point can sit between a `\` and the `|` it frees.
	return {
		newRaw: spliced,
		caretOffset: escapedCellOffset(spliced, effectiveOffset + cleaned.length)
	};
}

export const tableCellPasteSurface: PasteSurface = {
	kind: 'tableCell',
	blankEdgesArePackaging: true,
	onInlinePaste: tableCellInlinePaste,
	onScopedStructuralPaste: tableCellScopedStructuralPaste
};

// ── Internal ───────────────────────────────────────────────────────────────

// The cell's blockEdit is the row-level nested bundle (its `replaceBlock` targets the
// row's cells), so the splice routes through `replaceBlockAtParent` at the table's parent.
async function tableCellScopedStructuralPaste(input: ScopedStructuralPasteInput): Promise<void> {
	const tablePath = input.targetPath.slice(0, -2);
	const rowIdx = input.targetPath[input.targetPath.length - 2];
	const table = blockNodeAt(input.doc, tablePath);
	// Malformed path: swallow the paste.
	if (!table || table.kind !== 'table') return;

	const { firstHalf, secondHalf } = sliceTableAtRow(table, rowIdx, 'first');
	const replacement: CstNode[] = [];
	if (firstHalf) replacement.push(firstHalf);
	// Appended, never spread: a paste large enough to outnumber an argument list would
	// raise "Maximum call stack size exceeded" at the call.
	for (const block of input.blocks) replacement.push(block);
	if (secondHalf) replacement.push(secondHalf);

	await replaceBlockAtParent({
		doc: input.doc,
		blockPath: tablePath,
		replacement,
		controller: input.controller,
		undoEntry: input.undoEntry,
		// The last pasted block, before the second table half (the residue).
		focusReplacementIndex: focusIndexBeforeResidue(replacement.length, secondHalf !== null),
		focusOffset: CURSOR_END,
		source: 'paste-dispatch-table-cell'
	});
}
