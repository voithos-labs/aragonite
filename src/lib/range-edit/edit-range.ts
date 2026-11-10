/**
 * A gesture over a range of a Markdown document, answered in bytes: copy, cut, Backspace or Delete,
 * the removal a typed key, a composition or a command makes first, a paste, a drop. It reads the
 * document through `host` and returns the new bytes, where the caret lands and what a copy or a cut
 * puts on the clipboard; the editor applies the answer. The laws it keeps are `test/range-edit/laws.ts`.
 */

import type { SpliceCaret } from '../action-contracts';
import { getContentRange, structuralSuffix } from '../core/inline';
import { isBlankText } from '../core/lines';
import type { Mode, RangeHost } from './host';
import { copyOf } from './copy';
import {
	contentEnd,
	factsOf,
	findWithin,
	isCell,
	leafHolding,
	nodeAt,
	pointedBlock,
	readDoc,
	titleOwner,
	type Doc
} from './document';
import type { LaidBlock } from './layout';
import { byteAt, writeText, type Edit } from './leaf-splice';
import { ownEntry, restored } from './own-entry';
import { numberedOn } from './list-numbers';
import { pasteAt } from './paste';
import { removeRange, type Removal } from './removal';
import { fenceBody, holdsText } from './removal-range';

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
	// What the gesture leaves is read with the line ending its source started with.
	const read = (edit: Edit) => ({ ...readDoc(edit.source, host, mode), ending: doc.ending });
	const answer = (edit: Removal): RangeEditResult => ({
		source: edit.source,
		caret: caretOf(edit, read(edit), besideOf(gesture))
	});
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
		if (from === to || inOneText(doc, from, to))
			return answer(pasteAt(doc, from, to, gesture.paste, gesture.plain));
		// Across blocks the paste lands where the removal's caret does, as a cut's then a paste's
		// would, and over one block held whole takes its place, as typed text does.
		const removed = removalEdit(doc, from, to, 'type');
		const after = read(removed);
		const at = caretOf(removed, after).at;
		return answer(pasteAt(after, at, at, gesture.paste, gesture.plain));
	}
	const { removed, clipboard, own } = taken(doc, from, to);
	const { drop } = gesture;
	if (gesture.copy) return answer(pasteAt(doc, drop, drop, clipboard, false));
	// A moving drop is a cut, then a paste of its text and own entry at the drop point.
	const after = read(removed);
	const at = drop <= from ? drop : drop - (source.length - removed.source.length);
	return answer(restored(removed.source, at, at, own) ?? pasteAt(after, at, at, clipboard, false));
}

/** Whether the range sits in one block's text, between its fence lines where it has them: a paste
 *  over it is that block's one write. A block held whole gives way to the text instead. */
function inOneText(doc: Doc, from: number, to: number): boolean {
	const held = leafHolding(doc, from, to);
	if (!held || heldAlone(doc, from, to)) return false;
	const { leaf } = held;
	const fence = titleOwner(doc, leaf) ? null : doc.host.fence(nodeAt(doc, leaf.path).raw);
	return !fence || (held.from >= fence.body && (fence.closer === null || held.to < fence.closer));
}

/** A removal's answer alone, for a caller that never pastes, so the paste stays unloaded. */
export function removalOf(
	source: string,
	range: Range,
	gesture: RemovalGesture,
	mode: Mode,
	host: RangeHost
): RemovalAnswer {
	const removed = removalEdit(readDoc(source, host, mode), range.from, range.to, gesture);
	return {
		...answerOf(removed, gesture, host, mode),
		...(removed.took && { took: removed.took })
	};
}

/** A removal's answer, and the block the range started in, by its path, when it went whole: text
 *  over the range opens a paragraph there when the caret holds no prose. */
export interface RemovalAnswer extends RangeEditResult {
	took?: readonly number[];
}

/** Text over a range inside one table cell, for a caller that never pastes elsewhere; null for any
 *  other range, or text holding a line break. */
export function textInCell(
	source: string,
	range: Range,
	text: string,
	mode: Mode,
	host: RangeHost
): RangeEditResult | null {
	const doc = readDoc(source, host, mode);
	const held = leafHolding(doc, range.from, range.to);
	if (!held || !isCell(doc, held.leaf) || /[\r\n]/.test(text)) return null;
	// One write, since a cell stores no edge space: a removal would lose the space it leaves.
	const cell = writeText(doc, held.leaf, held.from, held.to, text);
	return { source: cell.source, caret: { at: cell.caret, holds: 'text' } };
}

/** A removal of the blocks `range` spans as blocks asked for (the block menu's Delete), not text:
 *  `Doc.wholeBlocks` says what that changes. */
export function wholeBlocksRemovalOf(
	source: string,
	range: Range,
	gesture: RemovalGesture,
	mode: Mode,
	host: RangeHost
): RangeEditResult {
	const doc = { ...readDoc(source, host, mode), wholeBlocks: true };
	return answerOf(removeRange(doc, range.from, range.to), gesture, host, mode);
}

function answerOf(removed: Removal, gesture: RemovalGesture, host: RangeHost, mode: Mode) {
	const caret = caretOf(removed, readDoc(removed.source, host, mode), besideOf(gesture));
	return { source: removed.source, caret };
}

/** Where a caret goes beside blocks the range took whole, no text left at its start: the block
 *  before's end, the block after's text, or its first byte, where a paste puts a cut back. */
type Beside = 'end before' | 'text after' | 'start after';

function besideOf(gesture: Gesture): Beside {
	if (gesture === 'backspace' || gesture === 'command') return 'end before';
	return gesture === 'delete' || gesture === 'compose' ? 'text after' : 'start after';
}

/** What a removal gesture leaves: text typed over one block held whole takes its place, and the
 *  line stays. */
function removalEdit(doc: Doc, from: number, to: number, gesture: RemovalGesture): Removal {
	if (gesture !== 'type' || !heldAlone(doc, from, to)) return removeRange(doc, from, to);
	const out = doc.source.slice(0, from) + doc.source.slice(to);
	return { source: numberedOn(doc, from, to, out), caret: from };
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
 *  start or a boundary, or where no text stayed, the side `beside` names. */
function caretOf(edit: Removal, result: Doc, beside: Beside = 'start after'): SpliceCaret {
	const side = !edit.gone
		? null
		: beside === 'end before'
			? endBefore(result, edit.caret)
			: beside === 'text after'
				? startAfter(result, edit.caret)
				: beforeFence(result, edit.caret);
	if (side) return side;
	let at = edit.caret;
	const lineStart = edit.source.lastIndexOf('\n', at - 1) + 1;
	while (at > lineStart && !result.layout.pointAt(at)) at--;
	if (edit.source === '' || result.layout.pointAt(at)) return { at, holds: 'text' };
	const block = findWithin(result, edit.caret, edit.caret, (b) => b.from === edit.caret);
	return { at: edit.caret, holds: block ? 'block' : 'boundary' };
}

/** The end of the block before byte `at`: the last place a caret takes in its text, or the block
 *  itself where it has no text position (a rule). Null where no block comes before. */
function endBefore(doc: Doc, at: number): SpliceCaret | null {
	for (let byte = at - 1; byte >= 0; byte--) {
		const block = pointedBlock(doc, byte);
		if (!block) continue;
		if (factsOf(doc, block).textPosition === 'never') return { at: block.from, holds: 'block' };
		// A caret ends after a character, and before a line ending, both bytes of a pair.
		const { source } = doc;
		const end = !/[\r\n]/.test(source[byte])
			? byte + 1
			: source[byte - 1] === '\r'
				? byte - 1
				: byte;
		return { at: Math.min(end, lastCaretByte(doc, block)), holds: 'text' };
	}
	return null;
}

/** The boundary before the fenced block starting at byte `at`, whose fence line takes no caret. */
function beforeFence(doc: Doc, at: number): SpliceCaret | null {
	const block = pointedBlock(doc, at);
	return block?.from === at && fenceBody(doc, block) ? { at, holds: 'boundary' } : null;
}

/** The first block from byte `at` on, past the parent the removal ended: a fenced block's body
 *  start (its fence lines take no caret), or the block itself where it has no text position. */
function startAfter(doc: Doc, at: number): SpliceCaret | null {
	for (let byte = at; byte < doc.source.length; byte++) {
		const block = pointedBlock(doc, byte);
		if (!block || block.from < at) continue;
		if (factsOf(doc, block).textPosition === 'never') return { at: block.from, holds: 'block' };
		return { at: fenceBody(doc, block)?.from ?? block.from, holds: 'text' };
	}
	return null;
}

/** A leaf's last caret place: a fenced block's body end, else its text's end past a structural
 *  suffix the block draws after it (a setext underline). */
function lastCaretByte(doc: Doc, leaf: LaidBlock): number {
	const body = fenceBody(doc, leaf);
	if (body) return body.to;
	const node = nodeAt(doc, leaf.path);
	return byteAt(doc, leaf, getContentRange(node).end + structuralSuffix(node).length);
}
