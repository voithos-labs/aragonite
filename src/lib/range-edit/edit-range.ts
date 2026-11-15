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
	containersHolding,
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
import { blankedApart, byteAt, writeText, type Edit, type LeafEdit } from './leaf-splice';
import { ownEntry, restored } from './own-entry';
import { numberedOn } from './list-numbers';
import { asPasted, pasteAt, type Pasted } from './paste';
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
	| 'command'
	/** The removal a line break makes first (Enter, Shift+Enter), which writes forward. */
	| 'break';

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
		caret: caretOf(edit, result, besideOf(gesture, doc, range), started)
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
		const ended = asPasted(doc, from, to, gesture.paste).endsWith('\n');
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
		const alone = heldAlone(doc, from, to);
		const blank = gesture.paste !== '' && isBlankText(gesture.paste);
		const removed =
			alone && blank ? blankedOut(doc, alone, to) : removalEdit(doc, from, to, 'type');
		const after = read(removed);
		const caret = caretOf(removed, after, 'start after', () => startedIn(doc, from));
		const over = pasteAt(after, caret.at, caret.at, pasted(alone ? TEXT : caret));
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
	// A drop point past the cut's caret lay in what the cut took, so the caret is where it stands.
	const before = Math.min(drop, removed.caret);
	const at = drop <= from ? before : drop - (source.length - removed.source.length);
	return answer(restored(removed.source, at, at, own) ?? pasteAt(after, at, at, dropped));
}

const TEXT: Held = { holds: 'text' };

/** Whether text ending in a line ending lands at `at` on a last line with none, in no literal
 *  text and over no range that empties the document, which has no last line to keep. */
function opensLastLine(doc: Doc, from: number, to: number, at: number, text: string): boolean {
	const { source } = doc;
	if (!source || ownTrailingLineEnding(source) || !asPasted(doc, at, at, text).endsWith('\n'))
		return false;
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
	return answerOf(removalEdit(doc, range.from, range.to, gesture), gesture, doc, range);
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
	return answerOf(removeRange(doc, range.from, range.to), gesture, doc, range);
}

function answerOf(
	removed: Removal,
	gesture: RemovalGesture,
	doc: Doc,
	range: Range
): RemovalAnswer {
	const { from } = range;
	const result = readDoc(removed.source, doc.host, doc.mode);
	const started = () => startedIn(doc, from);
	const caret = caretOf(removed, result, besideOf(gesture, doc, range), started);
	const at = removed.took;
	if (at === undefined) return { source: removed.source, caret };
	return { source: removed.source, caret, taken: { at, parent: parentAt(result, at, started) } };
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
 *  before's end, the block after's text or first byte, or where a line break goes (`lineBreakAt`). */
type Beside = 'end before' | 'text after' | 'start after' | 'break inside' | 'break between';

function besideOf(gesture: Gesture, doc: Doc, range: Range): Beside {
	if (gesture === 'break') return entersAtEnd(doc, range) ? 'break inside' : 'break between';
	if (gesture === 'backspace' || gesture === 'command') return 'end before';
	// A composition is typing: it joins the text after only where that text is the end leaf's own.
	if (gesture === 'compose') return entersAtEnd(doc, range) ? 'text after' : 'start after';
	return gesture === 'delete' ? 'text after' : 'start after';
}

/** Whether the range ends before the end of a leaf that starts inside it, so that leaf's text
 *  follows the caret: a block after the leaf is one the range never reached. */
const entersAtEnd = (doc: Doc, { from, to }: Range): boolean =>
	findWithin(
		doc,
		to,
		to,
		(b) => !!b.text && from <= b.from && b.from < to && to < contentEnd(doc, b)
	) !== undefined;

/** What a removal gesture leaves: text typed over one block held whole takes its place, and the
 *  line stays. */
function removalEdit(doc: Doc, from: number, to: number, gesture: RemovalGesture): Removal {
	if (gesture !== 'type' || !heldAlone(doc, from, to)) return removeRange(doc, from, to);
	const out = doc.source.slice(0, from) + doc.source.slice(to);
	return { source: numberedOn(doc, from, to, out), caret: from };
}

/** What blank text pasted over `block`, held whole up to `to`, leaves before it lands: the block's
 *  line blank, less the blank line under it, as the block's emptying write leaves them. */
function blankedOut(doc: Doc, block: LaidBlock, to: number): Removal {
	const out = doc.source.slice(0, block.from) + doc.source.slice(to);
	const { source, caret } = blankedApart(doc, block, { source: out, caret: block.from });
	return { source: numberedOn(doc, block.from, to, source), caret };
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
	const { after } = edit;
	const side =
		after === undefined
			? null
			: beside === 'end before'
				? endBefore(result, edit.caret)
				: beside === 'text after'
					? startAfter(result, edit.caret, after)
					: beside === 'start after'
						? beforeFence(result, edit.caret)
						: lineBreakAt(result, edit.caret, after, beside === 'break inside');
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
		if (owner && joinsName(doc, owner, block, block.text!.to)) return underRow(owner, block, at);
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

/** The boundary under `owner`'s title row `row`, inside the container, at byte `at`. */
function underRow(owner: LaidBlock, row: LaidBlock, at: number): Place {
	// A block removed past the container's closing line still lands inside, under the row.
	const line = lineOf(owner, at);
	const closes = line.own && line.from > row.from;
	return { at: closes ? Math.min(at, line.from) : at, holds: 'boundary', parent: owner.path };
}

/** Where a line break goes: before the text after where the range ended inside a leaf's text, else
 *  at the end before; beside a title row, which takes none, in the gap on the range's side. */
function lineBreakAt(doc: Doc, caret: number, after: number, inside: boolean): Place | null {
	const before = inside ? null : endBefore(doc, caret);
	const place = before ?? startAfter(doc, caret, after);
	const row = place?.holds === 'text' ? pointedBlock(doc, place.at) : undefined;
	const owner = row && titleOwner(doc, row);
	if (!owner) return place;
	return before ? underRow(owner, row, caret) : { at: owner.from, ...held('boundary', owner) };
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

/** The text after the range, from byte `after` where what followed it begins: the end block's own
 *  text where some stayed, else the next block's start, or a boundary in an entered container. */
function startAfter(doc: Doc, caret: number, after: number): Place | null {
	// The containers whose openings the removal kept before `after`: the text after stays inside them.
	const opened = containersHolding(doc, after).filter((c) => c.from >= caret && c.from < after);
	const entered = opened.at(-1);
	// A block the removal left at the caret, outside what it entered, holds the caret where it is,
	// unless it is the block the text after is in, slid up to the caret.
	const left = pointedBlock(doc, caret);
	const holds = left?.from === caret && opened[0]?.from !== caret && after >= left.to;
	const from = holds ? caret : after;
	const end = pointedBlock(doc, from);
	const text = end?.text;
	// A block that starts before `from` and still has text there is the end's, its first part gone.
	const kept = text && end.from < from && text.from <= from && from < text.to;
	if (kept) return { at: from, holds: 'text' };
	for (let byte = from; byte < (entered?.to ?? doc.source.length); byte++) {
		const block = pointedBlock(doc, byte);
		if (!block || block.from < from) continue;
		if (factsOf(doc, block).textPosition === 'never')
			return { at: block.from, ...held('block', block) };
		return { at: fenceBody(doc, block)?.from ?? block.from, holds: 'text' };
	}
	return entered ? { at: after, holds: 'boundary', parent: entered.path } : null;
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
