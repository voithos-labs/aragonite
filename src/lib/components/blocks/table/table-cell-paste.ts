/**
 * How a table cell takes in pasted text. The bytes are the kind's business: every hook hands back
 * plain spliced text, and the cell's write rule (`schema/table-cell-raw.ts`) runs when it is written.
 */

import { CURSOR_END } from '../../../block-component';
import type { CstNode } from '../../../core/nodes';
import { blockNodeAt } from '../../../tree-operations/node-primitives';
import { cutRangeFromDisplay } from '../../../tree-operations/node-ops';
import { sliceTableAtRow } from '../../../tree-operations/paste/table-slice';
import { focusIndexBeforeResidue } from '../../../tree-operations/paste/focus-target';
import { landClipboardBlocks, landedAfter } from '../../../tree-operations/paste/paste-replacement';
import { documentLineEnding, trimWhitespace } from '../../../core/lines';
import type {
	InlinePasteResult,
	PasteRange,
	PasteSurface,
	ScopedStructuralPasteInput
} from '../../../tree-operations/paste-surfaces';
import type { Reading } from '../../../schema/reading';

// ── Public API ─────────────────────────────────────────────────────────────

export function normalizeWhitespace(s: string): string {
	return trimWhitespace(s.replace(/\n+/g, ' '));
}

export function tableCellInlinePaste(
	node: CstNode,
	offset: number,
	text: string,
	preDelete: PasteRange | undefined,
	reading: Reading
): InlinePasteResult {
	const cleaned = normalizeWhitespace(text);

	// The delete half goes through the join rules first (live-mode.md § 4.5); the kind's pipe
	// escaping runs over whatever they produce.
	const { display: raw, offset: effectiveOffset } = cutRangeFromDisplay(
		node,
		node.raw,
		preDelete ?? { start: offset, end: offset },
		reading
	);

	return {
		newRaw: raw.slice(0, effectiveOffset) + cleaned + raw.slice(effectiveOffset),
		caretOffset: effectiveOffset + cleaned.length
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
// row's cells), so the splice goes through the paste coordinator at the table's parent.
async function tableCellScopedStructuralPaste(input: ScopedStructuralPasteInput): Promise<void> {
	const tablePath = input.targetPath.slice(0, -2);
	const rowIdx = input.targetPath[input.targetPath.length - 2];
	const table = blockNodeAt(input.doc, tablePath);
	// Malformed path: drop the paste.
	if (!table || table.kind !== 'table') return;

	const { firstHalf, secondHalf } = sliceTableAtRow(table, rowIdx, 'first');
	const lineEnding = documentLineEnding(input.doc);
	const replacement: CstNode[] = [];
	if (firstHalf) replacement.push(firstHalf);
	const landed = landClipboardBlocks(firstHalf ?? undefined, input.blocks, lineEnding);
	// Appended, never spread: a paste can outnumber an argument list (G4.60).
	for (const block of landed) replacement.push(block);
	const last = replacement[replacement.length - 1];
	// The rows below the cell stay a table: with no blank line, the last block would read them.
	if (secondHalf) replacement.push(last ? landedAfter(last, secondHalf, lineEnding) : secondHalf);

	await input.controller.replaceBlock(
		tablePath,
		replacement,
		// The last pasted block, before the second half of the table.
		{
			replacementIndex: focusIndexBeforeResidue(replacement.length, secondHalf !== null),
			offset: CURSOR_END
		},
		{ source: 'paste-dispatch-table-cell' }
	);
}
