/**
 * A gesture over a range of a Markdown document, answered in bytes: copy, cut, Backspace or Delete,
 * the removal a typed key, a composition or a command makes first, a paste, a drop. It reads the
 * document through `host` and returns the new bytes, where the caret lands and what a copy or a cut
 * puts on the clipboard; the editor applies the answer. The laws it keeps are `test/range-edit/laws.ts`.
 */

import type { SpliceCaret } from '../action-contracts';
import { isBlankText } from '../core/lines';
import type { Mode, RangeHost } from './host';
import { copyOf } from './copy';
import { contentEnd, factsOf, findWithin, pointedBlock, readDoc, type Doc } from './document';
import type { LaidBlock } from './layout';
import type { Edit } from './leaf-splice';
import { ownEntry, restored } from './own-entry';
import { pasteAt } from './paste';
import { removeRange, type Removal } from './removal';
import { holdsText } from './removal-range';

/** Two byte offsets, `from <= to`, after the editor widened the range to every block it takes
 *  whole; a caret is a range with `from === to`. */
export interface Range {
	from: number;
	to: number;
}

/** A gesture that removes the range and pastes nothing. */
export type RemovalGesture =
	| 'cut'
	| 'backspace'
	| 'delete'
	/** The removal a typed character, a composition or a command key makes first. */
	| 'type'
	| 'compose'
	| 'command';

export type Gesture =
	| 'copy'
	| RemovalGesture
	/** Clipboard text with LF line endings, and the editor's own entry an earlier copy or cut
	 *  wrote, while the clipboard still holds it. */
	| { paste: string; plain: boolean; own?: string }
	/** The range dragged and dropped at byte `drop`: moved, or copied. */
	| { drop: number; copy: boolean };

export interface RangeEditResult {
	source: string;
	caret: SpliceCaret;
	/** What a copy or a cut writes to the clipboard. */
	clipboard?: string;
	/** The editor's own clipboard entry a copy or a cut writes beside it. */
	own?: string;
}

export function editRange(
	source: string,
	range: Range,
	gesture: Gesture,
	mode: Mode,
	host: RangeHost
): RangeEditResult {
	const doc = readDoc(source, host, mode);
	const { from, to } = range;
	const read = (edit: Edit) => readDoc(edit.source, host, mode);
	// Backspace and a command key take the side before a block the range took whole.
	const backward = gesture === 'backspace' || gesture === 'command';
	const answer = (edit: Removal): RangeEditResult => ({
		source: edit.source,
		caret: caretOf(edit, read(edit), backward)
	});
	// Text typed or pasted over one block held whole takes its place, and the line stays.
	const inPlace = { source: source.slice(0, from) + source.slice(to), caret: from };
	const replaced = heldAlone(doc, from, to);
	if (gesture === 'copy' || gesture === 'cut') {
		const { removed, clipboard, own } = taken(doc, from, to);
		if (gesture === 'cut') return { ...answer(removed), clipboard, own };
		return { source, caret: { at: to, holds: 'text' }, clipboard, own };
	}
	if (typeof gesture === 'string') return answer(removalEdit(doc, from, to, gesture));
	if ('paste' in gesture) {
		const own = gesture.plain ? undefined : gesture.own;
		const back = own === undefined ? null : restored(source, from, to, own);
		if (back) return answer(back);
		if (from === to) return answer(pasteAt(doc, from, gesture.paste, gesture.plain));
		// The paste lands where the removal's caret does, as a cut's then a paste's would.
		const removed = replaced ? inPlace : removeRange(doc, from, to);
		const after = read(removed);
		return answer(pasteAt(after, caretOf(removed, after).at, gesture.paste, gesture.plain));
	}
	const { removed, clipboard, own } = taken(doc, from, to);
	if (gesture.copy) return answer(pasteAt(doc, gesture.drop, clipboard, false));
	// A moving drop is a cut, then a paste of its text and own entry at the drop point.
	const after = read(removed);
	const at =
		gesture.drop <= from ? gesture.drop : gesture.drop - (source.length - removed.source.length);
	return answer(restored(removed.source, at, at, own) ?? pasteAt(after, at, clipboard, false));
}

/** A removal's answer alone, for a caller that never pastes, so the paste stays unloaded. */
export function removalOf(
	source: string,
	range: Range,
	gesture: RemovalGesture,
	mode: Mode,
	host: RangeHost
): RangeEditResult {
	return removalFrom(readDoc(source, host, mode), range, gesture);
}

/** The removal of the blocks `range` spans from first byte to text end, as blocks asked for (the
 *  block menu's Delete), not text: `Doc.wholeBlocks` says what that changes. */
export function wholeBlocksRemovalOf(
	source: string,
	range: Range,
	gesture: RemovalGesture,
	mode: Mode,
	host: RangeHost
): RangeEditResult {
	return removalFrom({ ...readDoc(source, host, mode), wholeBlocks: true }, range, gesture);
}

function removalFrom(doc: Doc, range: Range, gesture: RemovalGesture): RangeEditResult {
	const { host, mode } = doc;
	const removed = removalEdit(doc, range.from, range.to, gesture);
	const back = gesture === 'backspace' || gesture === 'command';
	return {
		source: removed.source,
		caret: caretOf(removed, readDoc(removed.source, host, mode), back)
	};
}

/** What a removal gesture leaves: text typed over one block held whole takes its place, and the
 *  line stays. */
function removalEdit(doc: Doc, from: number, to: number, gesture: RemovalGesture): Removal {
	if (gesture !== 'type' || !heldAlone(doc, from, to)) return removeRange(doc, from, to);
	return { source: doc.source.slice(0, from) + doc.source.slice(to), caret: from };
}

/** What a copy of `range` writes, the copy gesture alone: it reads nothing but `source`, so an
 *  editor whose host answers that read with its own tree parses nothing. */
export function copyRange(
	source: string,
	range: Range,
	mode: Mode,
	host: RangeHost
): { clipboard: string; own: string } {
	const { clipboard, own } = taken(readDoc(source, host, mode), range.from, range.to);
	return { clipboard, own };
}

/** What a removal of `[from, to)` takes, as a copy and a cut both write it; a range holding no text
 *  that it takes nothing from (a hidden fence, markers alone) copies blank lines at most. */
function taken(doc: Doc, from: number, to: number) {
	const removed = removeRange(doc, from, to);
	const copy = copyOf(doc, from, to);
	const copies = removed.source !== doc.source || isBlankText(copy) || holdsText(doc, from, to);
	return { removed, clipboard: copies ? copy : '', own: ownEntry(doc.source, from, to, removed) };
}

/** The range is exactly one block other than a paragraph, from its first byte to the end of its
 *  last line. */
function heldAlone(doc: Doc, from: number, to: number): boolean {
	const alone = (b: LaidBlock) =>
		b.from === from && contentEnd(doc, b) === to && factsOf(doc, b).joins !== 'text';
	return from < to && findWithin(doc, from, from, alone) !== undefined;
}

/** The caret named by what the new bytes hold there: text, the text before it on its line, a block
 *  start or a boundary; `back` (Backspace's side) takes the block before where no text stayed. */
function caretOf(edit: Removal, result: Doc, back = false): SpliceCaret {
	const before = back && edit.gone ? endBefore(result, edit.caret) : null;
	if (before) return before;
	let at = edit.caret;
	const lineStart = edit.source.lastIndexOf('\n', at - 1) + 1;
	while (at > lineStart && !result.layout.pointAt(at)) at--;
	if (edit.source === '' || result.layout.pointAt(at)) return { at, holds: 'text' };
	const block = findWithin(result, edit.caret, edit.caret, (b) => b.from === edit.caret);
	return { at: edit.caret, holds: block ? 'block' : 'boundary' };
}

/** The end of the block before byte `at`: its text's end, or the block itself where it has no text
 *  position (a rule). Null where no block comes before. */
function endBefore(doc: Doc, at: number): SpliceCaret | null {
	for (let byte = at - 1; byte >= 0; byte--) {
		const block = pointedBlock(doc, byte);
		if (!block) continue;
		if (factsOf(doc, block).textPosition === 'never') return { at: block.from, holds: 'block' };
		return { at: Math.min(byte, block.text?.to ?? byte), holds: 'text' };
	}
	return null;
}
