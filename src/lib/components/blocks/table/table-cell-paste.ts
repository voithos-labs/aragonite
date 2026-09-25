/**
 * How a table cell takes in pasted text: the caret mapping that follows the backslashes the
 * write path inserts, plus the paste hooks it exposes. The bytes are the kind's business:
 * every hook hands back plain spliced text and `normalizeCellRaw` runs when it is written.
 */

import { CURSOR_END } from '../../../block-component';
import { normalizeCellRaw } from '../../../schema/table-cell-raw';
import type { CstNode } from '../../../core/nodes';
import { blockNodeAt } from '../../../tree-operations/node-primitives';
import { cutRangeFromDisplay } from '../../../tree-operations/node-ops';
import { sliceTableAtRow } from '../../../tree-operations/paste/table-slice';
import { focusIndexBeforeResidue } from '../../../tree-operations/paste/focus-target';
import { landClipboardBlocks, landedAfter } from '../../../tree-operations/paste/paste-replacement';
import { documentLineEnding } from '../../../core/lines';
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
 * Where `offset` lands once `normalizeCellRaw` has run, worked out by that same pass over
 * the prefix, so the caret cannot drift out of step with the bytes.
 */
export function escapedCellOffset(text: string, offset: number): number {
	return normalizeCellRaw(text.slice(0, offset)).length;
}

export function tableCellInlinePaste(
	node: CstNode,
	offset: number,
	text: string,
	preDelete: PasteRange | undefined,
	seam: PasteSeam
): InlinePasteResult {
	const cleaned = normalizeWhitespace(text);

	// The delete half goes through the join rules first (live-mode.md § 4.5); the kind's pipe
	// escaping runs over whatever they produce.
	const { display: raw, offset: effectiveOffset } = cutRangeFromDisplay(
		node,
		node.raw,
		preDelete ?? { start: offset, end: offset },
		seam.presentationMode,
		seam.linkRef
	);

	const spliced = raw.slice(0, effectiveOffset) + cleaned + raw.slice(effectiveOffset);
	// An escaped space, because the write path escapes the whole spliced raw and not just
	// the pasted text: the insertion point can sit between a `\` and the `|` it frees.
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
	// Malformed path: drop the paste.
	if (!table || table.kind !== 'table') return;

	const { firstHalf, secondHalf } = sliceTableAtRow(table, rowIdx, 'first');
	const lineEnding = documentLineEnding(input.doc);
	const replacement: CstNode[] = [];
	if (firstHalf) replacement.push(firstHalf);
	// No text of the cell continues the last block, so it always ends its own line.
	const landed = landClipboardBlocks(firstHalf ?? undefined, input.blocks, lineEnding, true);
	// Appended, never spread: a paste can outnumber an argument list (G4.60).
	for (const block of landed) replacement.push(block);
	const last = replacement[replacement.length - 1];
	// The rows below the cell stay a table: with no blank line, the last block would read them.
	if (secondHalf) replacement.push(last ? landedAfter(last, secondHalf, lineEnding) : secondHalf);

	await replaceBlockAtParent({
		doc: input.doc,
		blockPath: tablePath,
		replacement,
		controller: input.controller,
		undoEntry: input.undoEntry,
		// The last pasted block, before the second half of the table.
		focusReplacementIndex: focusIndexBeforeResidue(replacement.length, secondHalf !== null),
		focusOffset: CURSOR_END,
		source: 'paste-dispatch-table-cell',
		grammar: input.grammar
	});
}
