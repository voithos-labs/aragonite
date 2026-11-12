/**
 * The pastes a table cell answers itself, ahead of the range-edit core: a grid (spreadsheet tabs or
 * a GFM table) fills cells, and a clipboard of blocks slices the table at the cell's row and lands
 * between the halves. Any other paste is text on the cell's one line, which the core writes.
 */

import { CURSOR_END } from '../../../block-component';
import type { CstNode } from '../../../core/nodes';
import { blockNodeAt } from '../../../tree-operations/node-primitives';
import { replaceDrawnRange } from '../../../tree-operations/leaf-range';
import { sliceTableAtRow } from '../../../tree-operations/paste/table-slice';
import { focusIndexBeforeResidue } from '../../../tree-operations/paste/focus-target';
import { landClipboardBlocks, landedAfter } from '../../../tree-operations/paste/paste-replacement';
import {
	documentLineEnding,
	trimTrailingLineEnding,
	trimWhitespace,
	withLineEnding
} from '../../../core/lines';
import type {
	ClipPasteInput,
	InlinePasteResult,
	PasteRange,
	PasteSurface,
	ScopedStructuralPasteInput
} from '../../../tree-operations/paste-surfaces';
import { readBlocks } from '../../../core/parser';
import { pasteTableGrid } from '../../../editor-actions/table-context';
import { normalizeClipboardForBody } from '../../../tree-operations/paste/body-write';
import { escapeMarkdownLiteral } from '../../../tree-operations/paste/markdown-literal';
import { applyPasteTransforms } from '../../../tree-operations/paste/paste-transforms';
import { contentBlocks, pickPasteStrategy } from '../../../tree-operations/paste/strategy';
import { parseClipboardGrid, tileGridTo } from '../../../tree-operations/table-grid-clipboard';
import type { StoredAs } from '../../../schema/stored-as';

// ── Public API ─────────────────────────────────────────────────────────────

export function normalizeWhitespace(s: string): string {
	return trimWhitespace(s.replace(/\n+/g, ' '));
}

export function tableCellInlinePaste(
	node: CstNode,
	offset: number,
	text: string,
	preDelete: PasteRange | undefined,
	store: StoredAs
): InlinePasteResult {
	// The kind's pipe escaping runs over whatever the join writes, when the cell is written.
	const cleaned = normalizeWhitespace(text);
	const edit = replaceDrawnRange(node, preDelete ?? { start: offset, end: offset }, cleaned, store);
	return { newRaw: trimTrailingLineEnding(edit.raw), caretOffset: edit.caret };
}

export const tableCellPasteSurface: PasteSurface = {
	kind: 'tableCell',
	blankEdgesArePackaging: true,
	onInlinePaste: tableCellInlinePaste,
	onScopedStructuralPaste: (input) => sliceTableForBlocks(input).then(() => undefined),
	onClipPaste: async (input) => (await pasteGridInto(input)) || pasteBlocksAround(input)
};

// ── A grid, then blocks ────────────────────────────────────────────────────

/** A grid fills cells from the held rectangle's top-left, tiled to it, or from the cell, growing
 *  the table. Plain text is escaped first, as the cell's own text would be. */
async function pasteGridInto(input: ClipPasteInput): Promise<boolean> {
	const { targetPath, clip, cells } = input;
	const grid = parseClipboardGrid(clip.plain ? escapeMarkdownLiteral(clip.text) : clip.text);
	const tablePath = targetPath.slice(0, -2);
	const table = blockNodeAt(input.doc, tablePath);
	const rowsState = table && input.controller.resolveState(table);
	if (!grid || !table || !rowsState) return false;
	const [rowIdx, colIdx] = targetPath.slice(-2);
	const origin = cells ? { rowIdx: cells.top, colIdx: cells.left } : { rowIdx, colIdx };
	const fitted = cells ? tileGridTo(grid, cells.rows, cells.cols) : grid;
	await pasteTableGrid({ node: table, myPath: tablePath, rowsState, ...input }, origin, fitted);
	return true;
}

/** The slice is picked on the clipboard as it came; the paste transforms run after, and never on
 *  the editor's own entry. */
async function pasteBlocksAround(input: ClipPasteInput): Promise<boolean> {
	const { doc, targetPath, clip, reading } = input;
	const ending = documentLineEnding(doc);
	const read = (text: string) =>
		contentBlocks(
			readBlocks(withLineEnding(normalizeClipboardForBody(doc, targetPath, text), ending), {
				grammar: reading.grammar,
				scope: 'fragment'
			}).children
		);
	const raw = clip.plain ? escapeMarkdownLiteral(clip.text) : clip.text;
	if (pickPasteStrategy(read(raw)) !== 'structural') return false;
	const transforms = !clip.plain && clip.own === undefined;
	const text = transforms ? applyPasteTransforms(raw, input.activePlugins) : raw;
	const blocks = text === raw ? read(raw) : read(text);
	if (blocks.length === 0) return false;
	const landed = await sliceTableForBlocks({ ...input, blocks: blocks.slice() });
	return landed !== null;
}

// ── Internal ───────────────────────────────────────────────────────────────

// The cell's blockEdit is the row-level nested bundle (its `replaceBlock` targets the
// row's cells), so the splice goes through the paste coordinator at the table's parent.
async function sliceTableForBlocks(input: ScopedStructuralPasteInput): Promise<number | null> {
	const tablePath = input.targetPath.slice(0, -2);
	const rowIdx = input.targetPath[input.targetPath.length - 2];
	const table = blockNodeAt(input.doc, tablePath);
	// Malformed path: drop the paste.
	if (!table || table.kind !== 'table') return null;

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

	return input.controller.replaceBlock(
		tablePath,
		replacement,
		// The last pasted block, before the second half of the table.
		{
			replacementIndex: focusIndexBeforeResidue(replacement.length, secondHalf !== null),
			offset: CURSOR_END
		},
		// The commit targets the whole table, where no in-cell offset applies; the live read
		// records the cell's caret.
		{ pasted: landed.length, snapshotOffset: 0 }
	);
}
