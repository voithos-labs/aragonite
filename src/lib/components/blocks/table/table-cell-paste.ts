/**
 * Cell text ingestion for tableCell: the pipe-escaping primitive shared by every
 * write path, the caret-aware keystroke-commit wrapper, plus the inline +
 * scoped-structural paste hooks exposed as a PasteSurface the editor mount
 * registers (see built-in-blocks.ts).
 */

import { CURSOR_END } from '../../../block-component';
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

export function escapeUnescapedPipes(s: string): string {
	let out = '';
	for (let i = 0; i < s.length; i++) {
		const ch = s[i];
		if (ch !== '|') {
			out += ch;
			continue;
		}
		let backslashes = 0;
		for (let j = i - 1; j >= 0 && s[j] === '\\'; j--) backslashes++;
		out += backslashes % 2 === 0 ? '\\|' : '|';
	}
	return out;
}

export function normalizeWhitespace(s: string): string {
	return s.replace(/\n+/g, ' ').trim();
}

/**
 * Escape unescaped pipes in a cell's committed text and report where `caret`
 * lands once the backslashes are inserted. Typing (and IME commit) must produce
 * the same `\|` bytes a paste does — an unescaped `|` splits the row into extra
 * cells on reparse, shifting or dropping every cell after it. The caret shifts by
 * the backslashes inserted before it, so the re-render from raw seats it after
 * the escape it just typed, not inside the `\|` pair.
 */
export function escapeCellCommit(text: string, caret: number): { text: string; caret: number } {
	const escaped = escapeUnescapedPipes(text);
	if (escaped === text) return { text, caret };
	return { text: escaped, caret: escapeUnescapedPipes(text.slice(0, caret)).length };
}

export function tableCellInlinePaste(
	node: CstNode,
	offset: number,
	text: string,
	preDelete?: PasteRange
): InlinePasteResult {
	const cleaned = escapeUnescapedPipes(normalizeWhitespace(text));

	let raw = node.raw;
	let effectiveOffset = offset;
	if (preDelete && preDelete.start < preDelete.end) {
		raw = raw.slice(0, preDelete.start) + raw.slice(preDelete.end);
		effectiveOffset = preDelete.start;
	}

	const newRaw = raw.slice(0, effectiveOffset) + cleaned + raw.slice(effectiveOffset);
	return {
		newRaw,
		caretOffset: effectiveOffset + cleaned.length
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
