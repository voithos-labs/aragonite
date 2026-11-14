/**
 * A gesture over a range of a Markdown document, answered in bytes: copy, cut, Backspace or Delete,
 * the removal a typed key, a composition or a command makes first, a paste, a drop. It reads the
 * document through `host` and returns the new bytes, where the caret lands and what a copy or a cut
 * puts on the clipboard; the editor applies the answer. The laws it keeps are `test/range-edit/laws.ts`.
 */

import { getContentRange, structuralSuffix } from '../core/inline';
import { isBlankText, ownTrailingLineEnding, type LineEnding } from '../core/lines';
import type { Mode, PasteHost, RangeHost } from './host';
import { copyOf } from './copy';
import {
	contentEnd,
	factsOf,
	findWithin,
	holderAt,
	isCell,
	joinsName,
	leafHolding,
	lineOf,
	nodeAt,
	pointedBlock,
	readDoc,
	titleOwner,
	type Doc,
	type Held,
	type Place
} from './document';
import type { LaidBlock } from './layout';
import { byteAt, writeText, type Edit, type LeafEdit } from './leaf-splice';
import { ownEntry, restored } from './own-entry';
import { numberedOn } from './list-numbers';
import { pasteAt, type Pasted } from './paste';
import { removeRange, type Removal } from './removal';
import { bodyBetweenFences, fenceBody, holdsText } from './removal-range';

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
	/** Clipboard text with LF line endings, the editor's own entry, what the caret holds (anywhere
	 *  but in text the clipboard lands as blocks), and the line ending a removal before it took. */
	| ({ paste: string; plain: boolean; own?: string; ending?: LineEnding } & Held)
	/** The range dragged and dropped at byte `drop`: moved, or copied. */
	| { drop: number; copy: boolean };

export type { Held, Place };

export interface RangeEditResult {
	source: string;
	caret: Place;
	/** What a copy or a cut writes to the clipboard. */
	clipboard?: string;
	/** The editor's own clipboard entry a copy or a cut writes beside it. */
	own?: string;
	/** Set where a paste was one write of one text block of `source`: the editor may commit it as
	 *  that block's write, which leaves these bytes. */
	leaf?: LeafEdit;
	/** How many blocks a paste landed as; 0 where it went in as text. */
	blocks?: number;
}

export function editRange(
	source: string,
	range: Range,
	gesture: Gesture,
	mode: Mode,
	host: PasteHost
): RangeEditResult {
	const asRead = readDoc(source, host, mode);
	const carried = typeof gesture === 'object' && 'paste' in gesture ? gesture.ending : undefined;
	const doc = carried ? { ...asRead, ending: carried } : asRead;
	const { from, to } = range;
	// What the gesture leaves is read with the line ending its source started with.
	const read = (edit: Edit) => ({ ...readDoc(edit.source, host, mode), ending: doc.ending });
	const inside = typeof gesture === 'object' && 'parent' in gesture ? gesture.parent : from;
	const started = () => startedIn(doc, inside);
	const answer = (edit: Removal, result = read(edit)): RangeEditResult => ({
		source: edit.source,
		caret: caretOf(edit, result, besideOf(gesture), started)
	});
	if (gesture === 'copy' || gesture === 'cut') {
		const { removed, clipboard, own } = taken(doc, from, to);
		if (gesture === 'cut') return { ...answer(removed), clipboard, own };
		return { source, caret: { at: to, holds: 'text' }, clipboard, own };
	}
	if (typeof gesture === 'string') return answer(removalEdit(doc, from, to, gesture));
	// A line ending landing on a last line that has none lands as on one that has, then the break
	// comes back off unless the line left last is blank (`syntax-tree.md` § The last line).
	const reclosed = (at: number, text: string): RangeEditResult | null => {
		if (!opensLastLine(doc, from, to, at, text)) return null;
		const closed = editRange(source + doc.ending, range, gesture, mode, host);
		return reopened(closed, doc.ending, (body) => endsBlank(readDoc(body, host, mode)));
	};
	if ('paste' in gesture) {
		// The document's last line keeps the line ending it had, which blocks pasted after it spend.
		const ending = ownTrailingLineEnding(source);
		const keepLastEnding = (result: RangeEditResult): RangeEditResult =>
			!ending || !result.source || ownTrailingLineEnding(result.source)
				? result
				: { ...result, source: result.source + ending };
		const own = gesture.plain ? undefined : gesture.own;
		const back = own === undefined ? null : restored(source, from, to, own);
		if (back) return answer(back);
		const onClosed = reclosed(to, gesture.paste);
		if (onClosed) return onClosed;
		// A clipboard that carries the editor's own entry is the editor's own bytes: no transform runs.
		const transform: Pasted['transform'] =
			gesture.own === undefined ? (text, blocks) => host.transformPaste(text, blocks) : null;
		const pasted = (held: Held): Pasted => ({
			text: gesture.paste,
			plain: gesture.plain,
			held,
			transform
		});
		const ended = gesture.paste.endsWith('\n');
		// The empty line a last line ending opens is the caret's own, never the block below it, and
		// the caret the ending left as Enter is on a line it opened too.
		const lined = (result: RangeEditResult, edit: Edit): RangeEditResult =>
			(ended && result.caret.holds === 'boundary') || edit.entered
				? { ...result, caret: { ...result.caret, line: true } }
				: result;
		// Without that ending the caret stays in the last block pasted, at the last place it takes.
		const landed = (edit: Edit): RangeEditResult => {
			const result = read(edit);
			const last = ended || !edit.blocks ? null : lastPlaceAt(result, edit.caret);
			return lined(answer(last === null ? edit : { ...edit, caret: last }, result), edit);
		};
		// One write of one block of `source` is named where the caret stays on the text it wrote, so
		// the editor can make it as that block does.
		const inPlace = (edit: Edit): RangeEditResult => {
			const named = { ...landed(edit), blocks: edit.blocks ?? 0 };
			const { caret } = named;
			const kept = edit.leaf && caret.holds === 'text' && caret.at === edit.caret;
			return kept ? { ...named, leaf: edit.leaf } : named;
		};
		if (from === to) return keepLastEnding(inPlace(pasteAt(doc, from, to, pasted(gesture))));
		if (inOneText(doc, from, to))
			return keepLastEnding(inPlace(pasteAt(doc, from, to, pasted(TEXT))));
		// Across blocks the paste lands where the removal's caret does, as a cut's then a paste's
		// would, and over one block held whole takes its place, as typed text does.
		const removed = removalEdit(doc, from, to, 'type');
		const after = read(removed);
		const caret = caretOf(removed, after, 'start after', () => startedIn(doc, from));
		const alone = heldAlone(doc, from, to);
		const emptied = alone && { doc, block: alone };
		const over = pasteAt(after, caret.at, caret.at, { ...pasted(alone ? TEXT : caret), emptied });
		return keepLastEnding({ ...landed(over), blocks: over.blocks ?? 0 });
	}
	const { removed, clipboard, own } = taken(doc, from, to);
	const { drop } = gesture;
	const dropped: Pasted = { text: clipboard, plain: false, held: TEXT, transform: null };
	const onClosed = reclosed(drop, clipboard);
	if (onClosed) return onClosed;
	if (gesture.copy) return answer(pasteAt(doc, drop, drop, dropped));
	// A moving drop is a cut, then a paste of its text and own entry at the drop point.
	const after = read(removed);
	const at = drop <= from ? drop : drop - (source.length - removed.source.length);
	return answer(restored(removed.source, at, at, own) ?? pasteAt(after, at, at, dropped));
}

const TEXT: Held = { holds: 'text' };

/** Whether text ending in a line ending lands at `at` on a last line with none, in no literal
 *  text and over no range that empties the document, which has no last line to keep. */
function opensLastLine(doc: Doc, from: number, to: number, at: number, text: string): boolean {
	const { source } = doc;
	if (!source || ownTrailingLineEnding(source) || !text.endsWith('\n')) return false;
	if (source.includes('\n', at) || (from === 0 && to === source.length)) return false;
	const leaf = leafHolding(doc, at, at)?.leaf;
	return !leaf || factsOf(doc, leaf).body !== 'literal';
}

/** `closed`, a paste into the document given the last line ending it lacked: the ending goes
 *  again unless the line left last is blank, which keeps it as Enter's does. */
function reopened(
	closed: RangeEditResult,
	eol: string,
	blank: (source: string) => boolean
): RangeEditResult {
	// The one write of a block was the closed document's.
	const result: RangeEditResult = { ...closed, leaf: undefined };
	const { source, caret } = result;
	if (!source.endsWith(eol)) return result;
	const body = source.slice(0, -eol.length);
	const line = body.lastIndexOf('\n') + 1;
	if (!blank(source)) {
		return { ...result, source: body, caret: { ...caret, at: Math.min(caret.at, body.length) } };
	}
	// An empty last line right under a block's last line is Enter's empty paragraph there.
	const under = line > 0 && !isBlankText(body.slice(body.lastIndexOf('\n', line - 2) + 1, line));
	if (line < body.length || caret.at !== line || !under) return result;
	const at = line + eol.length;
	return { ...result, source: body + eol + eol, caret: { at, holds: 'text', line: true } };
}

/** Whether the last line of `doc`, which ends in a line ending, is blank: an empty block's (an empty
 *  item's or quote's paragraph), or an empty line; a container's own marker line is not. */
function endsBlank(doc: Doc): boolean {
	const { source } = doc;
	const end = source.length - ownTrailingLineEnding(source).length;
	const leaf = leafHolding(doc, end, end)?.leaf;
	if (leaf?.text) return isBlankText(source.slice(leaf.text.from, leaf.text.to));
	return /^\r?$/.test(source.slice(source.lastIndexOf('\n', end - 1) + 1, end));
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
	const doc = readDoc(source, host, mode);
	return answerOf(removalEdit(doc, range.from, range.to, gesture), gesture, doc, range.from);
}

/** A removal's answer, and where the block the range started in stood when it went whole, read on
 *  the bytes after: text over the range opens a paragraph there when the caret holds no prose. */
export interface RemovalAnswer extends RangeEditResult {
	taken?: { at: number; parent: readonly number[] };
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
	return answerOf(removeRange(doc, range.from, range.to), gesture, doc, range.from);
}

function answerOf(
	removed: Removal,
	gesture: RemovalGesture,
	doc: Doc,
	from: number
): RemovalAnswer {
	const result = readDoc(removed.source, doc.host, doc.mode);
	const started = () => startedIn(doc, from);
	const caret = caretOf(removed, result, besideOf(gesture), started);
	if (!removed.took) return { source: removed.source, caret };
	// The bytes before the range stay, so its first byte is where the taken block stood.
	return {
		source: removed.source,
		caret,
		taken: { at: from, parent: parentAt(result, from, started) }
	};
}

/** The blocks with children a gesture started among, outermost first: those around the block at
 *  the path a paste named, or those byte `inside` sits in past their first byte. */
function startedIn(doc: Doc, inside: number | readonly number[]): LaidBlock[] {
	if (typeof inside !== 'number')
		return inside.flatMap((_, i) => doc.layout.block(inside.slice(0, i + 1)) ?? []);
	const open = (b: LaidBlock) => inside < b.to || !doc.source.endsWith('\n', b.to);
	return [...doc.layout.within(inside, inside)].filter(
		(b) => !b.text && b.from < inside && open(b)
	);
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

/** The block the range is exactly, one other than a paragraph, from its first byte to the end of
 *  its last line. A cell's whole text is text of its table, never a block held alone. */
function heldAlone(doc: Doc, from: number, to: number): LaidBlock | undefined {
	const alone = (b: LaidBlock) =>
		b.from === from &&
		contentEnd(doc, b) === to &&
		factsOf(doc, b).joins !== 'text' &&
		!isCell(doc, b);
	return from < to ? findWithin(doc, from, from, alone) : undefined;
}

/** The caret named by what the new bytes hold there: text, the text before it on its line, a block
 *  start or a boundary, or where no text stayed, the side `beside` names. */
function caretOf(edit: Removal, result: Doc, beside: Beside, started: () => LaidBlock[]): Place {
	const side = !edit.gone
		? null
		: beside === 'end before'
			? endBefore(result, edit.caret)
			: beside === 'text after'
				? startAfter(result, edit.caret)
				: beforeFence(result, edit.caret);
	if (side) return side;
	const at = edit.caret;
	let text = at;
	const lineStart = edit.source.lastIndexOf('\n', at - 1) + 1;
	while (text > lineStart && !result.layout.pointAt(text)) text--;
	if (edit.source === '' || result.layout.pointAt(text)) return { at: text, holds: 'text' };
	const block = findWithin(result, at, at, (b) => b.from === at);
	if (block) return { at, holds: 'block', parent: block.path.slice(0, -1) };
	return { at, holds: 'boundary', parent: parentAt(result, at, started, edit.parent) };
}

/** The block whose children byte `at` sits among in `result`, each path from before the removal
 *  asked of `result`: the one the removal named, the deepest it started in, the nearest around. */
function parentAt(
	result: Doc,
	at: number,
	started: () => LaidBlock[],
	named?: LaidBlock | null
): readonly number[] {
	if (named === null) return [];
	const still = (b: LaidBlock) => {
		const now = result.layout.block(b.path);
		return !!now && !now.text && now.type === b.type && now.from <= at && at <= now.to;
	};
	const kept = named && still(named) ? named : started().findLast(still);
	return kept?.path ?? holderAt(result, at)?.path ?? [];
}

/** The end of the block before byte `at`, the block itself where it has no text position (a rule),
 *  or in live mode the boundary under a title row ending in its hidden `:::name`; null for none. */
function endBefore(doc: Doc, at: number): Place | null {
	for (let byte = at - 1; byte >= 0; byte--) {
		const block = pointedBlock(doc, byte);
		if (!block) continue;
		if (factsOf(doc, block).textPosition === 'never')
			return { at: block.from, ...held('block', block) };
		const owner = doc.mode === 'live' ? titleOwner(doc, block) : undefined;
		if (owner && joinsName(doc, owner, block, block.text!.to)) {
			// A block removed past the container's closing line still lands inside, under the row.
			const line = lineOf(owner, at);
			const closes = line.own && line.from > block.from;
			return { at: closes ? Math.min(at, line.from) : at, holds: 'boundary', parent: owner.path };
		}
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
function beforeFence(doc: Doc, at: number): Place | null {
	const block = pointedBlock(doc, at);
	return block?.from === at && fenceBody(doc, block) ? { at, ...held('boundary', block) } : null;
}

/** A place where `block` starts, among its parent's children. */
const held = (holds: 'block' | 'boundary', block: LaidBlock): Held => ({
	holds,
	parent: block.path.slice(0, -1)
});

/** The first block from byte `at` on, past the parent the removal ended: a fenced block's body
 *  start (its fence lines take no caret), or the block itself where it has no text position. */
function startAfter(doc: Doc, at: number): Place | null {
	for (let byte = at; byte < doc.source.length; byte++) {
		const block = pointedBlock(doc, byte);
		if (!block || block.from < at) continue;
		if (factsOf(doc, block).textPosition === 'never')
			return { at: block.from, ...held('block', block) };
		return { at: fenceBody(doc, block)?.from ?? block.from, holds: 'text' };
	}
	return null;
}

/** The last place a caret takes in the block ending at `at`: a fenced block's body end, a container's
 *  or a table's last text; null for text that ends there, or a block with no text place (a rule). */
function lastPlaceAt(doc: Doc, at: number): number | null {
	const block = [...doc.layout.within(at, at)].filter((b) => contentEnd(doc, b) === at).at(-1);
	if (!block || (block.text && !bodyBetweenFences(doc, block))) return null;
	return lastPlaceIn(doc, block);
}

function lastPlaceIn(doc: Doc, block: LaidBlock): number | null {
	if (factsOf(doc, block).textPosition === 'never') return null;
	if (block.text) return bodyBetweenFences(doc, block)?.to ?? block.text.to;
	const count = nodeAt(doc, block.path).children?.length ?? 0;
	const last = count > 0 ? doc.layout.block([...block.path, count - 1]) : undefined;
	return last ? lastPlaceIn(doc, last) : null;
}

/** A leaf's last caret place: a fenced block's body end, else its text's end past a structural
 *  suffix the block draws after it (a setext underline). */
function lastCaretByte(doc: Doc, leaf: LaidBlock): number {
	const body = fenceBody(doc, leaf);
	if (body) return body.to;
	const node = nodeAt(doc, leaf.path);
	return byteAt(doc, leaf, getContentRange(node).end + structuralSuffix(node).length);
}
