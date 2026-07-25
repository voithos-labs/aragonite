/**
 * Cell text ingestion for tableCell: the caret mapping that follows the sink's
 * inserted backslashes, plus the inline + scoped-structural paste hooks exposed
 * as a PasteSurface the editor mount registers (see built-in-blocks.ts).
 *
 * The bytes themselves are the kind's business, not this module's — every hook
 * below hands back plain spliced text and `normalizeCellRaw` runs at the write
 * sink. Three gestures once carried that escape here and each lost it.
 */

import { CURSOR_END } from '../../../block-component';
import { normalizeCellRaw } from '../../../schema/table-cell-raw';
import type { CstNode } from '../../../core/nodes';
import { blockNodeAt } from '../../../tree-operations/node-ops';
import { sliceTableAtRow } from '../../../tree-operations/paste/table-slice';
import { focusIndexBeforeResidue } from '../../../tree-operations/paste/focus-target';
import { replaceBlockAtParent } from '../../../tree-operations/paste/replace-block-at-parent';
import type {
	InlinePasteResult,
	PasteRange,
	PasteSurface,
	ScopedStructuralPasteInput
} from '../../../tree-operations/paste-surfaces';

// ── Public API ─────────────────────────────────────────────────────────────

export function normalizeWhitespace(s: string): string {
	return s.replace(/\n+/g, ' ').trim();
}

/**
 * Where `offset` lands in `text` once the sink's `normalizeCellRaw` has run over
 * it. Defined as that same pass over the prefix, so the caret cannot drift out of
 * step with the bytes the way a hand-kept backslash count would: the re-render
 * from raw seats the caret after an inserted escape, never inside the `\|` pair.
 */
export function escapedCellOffset(text: string, offset: number): number {
	return normalizeCellRaw(text.slice(0, offset)).length;
}

export function tableCellInlinePaste(
	node: CstNode,
	offset: number,
	text: string,
	preDelete?: PasteRange
): InlinePasteResult {
	const cleaned = normalizeWhitespace(text);

	let raw = node.raw;
	let effectiveOffset = offset;
	if (preDelete && preDelete.start < preDelete.end) {
		raw = raw.slice(0, preDelete.start) + raw.slice(preDelete.end);
		effectiveOffset = preDelete.start;
	}

	const spliced = raw.slice(0, effectiveOffset) + cleaned + raw.slice(effectiveOffset);
	// The caret is reported in escaped space because the sink escapes the whole
	// spliced raw, not just the pasted text: the insertion point can sit between a
	// `\` and the `|` it frees, and a preDelete can consume that `\` outright, so
	// the newly-freed pipe comes from the surrounding cell rather than the paste.
	return {
		newRaw: spliced,
		caretOffset: escapedCellOffset(spliced, effectiveOffset + cleaned.length)
	};
}

export const tableCellPasteSurface: PasteSurface = {
	kind: 'tableCell',
	onInlinePaste: tableCellInlinePaste,
	onScopedStructuralPaste: tableCellScopedStructuralPaste
};

// ── Internal ───────────────────────────────────────────────────────────────

// Structural paste into a cell breaks the table at the cell's row and splices
// the pasted blocks between the halves. The cell's blockEdit is the row-level
// nested bundle (its replaceBlock(i) targets the row's cells), so the splice
// routes through replaceBlockAtParent at the table's parent directly.
async function tableCellScopedStructuralPaste(input: ScopedStructuralPasteInput): Promise<void> {
	const tablePath = input.targetPath.slice(0, -2);
	const rowIdx = input.targetPath[input.targetPath.length - 2];
	const table = blockNodeAt(input.doc, tablePath);
	// Malformed path: swallow the paste.
	if (!table || table.kind !== 'table') return;

	const { firstHalf, secondHalf } = sliceTableAtRow(table, rowIdx, 'first');
	const replacement: CstNode[] = [];
	if (firstHalf) replacement.push(firstHalf);
	replacement.push(...input.blocks);
	if (secondHalf) replacement.push(secondHalf);

	await replaceBlockAtParent({
		doc: input.doc,
		blockPath: tablePath,
		replacement,
		controller: input.controller,
		undoEntry: input.undoEntry,
		// End of the pasted content: the last pasted block, before the second table
		// half (the residue) — never the first pasted block.
		focusReplacementIndex: focusIndexBeforeResidue(replacement.length, secondHalf !== null),
		focusOffset: CURSOR_END,
		source: 'paste-dispatch-table-cell'
	});
}
