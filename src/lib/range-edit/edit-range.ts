/**
 * A gesture over a range of a Markdown document, answered in bytes: copy, cut, Backspace or Delete,
 * the removal a typed key, a composition or a command makes first, a paste, a drop. It reads the
 * document through `host` and returns the new bytes, where the caret lands and what a copy or a cut
 * puts on the clipboard; the editor applies the answer. The laws it keeps are `test/range-edit/laws.ts`.
 */

import { getContentRange, structuralSuffix } from '../core/inline';
import { isBlankText } from '../core/lines';
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
import { byteAt, writeText, type Edit } from './leaf-splice';
import { ownEntry, restored } from './own-entry';
import { numberedOn } from './list-numbers';
import { pasteAt, type Pasted } from './paste';
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
	| 'command'
	/** The removal a line break makes first (Enter, Shift+Enter), which writes forward. */
	| 'break';

export type Gesture =
	| 'copy'
	| RemovalGesture
	/** Clipboard text with LF line endings, the editor's own entry while the clipboard still holds
	 *  it, and what the caret holds: anywhere but in text the clipboard lands as blocks of its own. */
	| ({ paste: string; plain: boolean; own?: string } & Held)
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
}

export function editRange(
	source: string,
	range: Range,
	gesture: Gesture,
	mode: Mode,
	host: PasteHost
): RangeEditResult {
	const doc = readDoc(source, host, mode);
	const { from, to } = range;
	// What the gesture leaves is read with the line ending its source started with.
	const read = (edit: Edit) => ({ ...readDoc(edit.source, host, mode), ending: doc.ending });
	const inside = typeof gesture === 'object' && 'parent' in gesture ? gesture.parent : from;
	const started = () => startedIn(doc, inside);
	const answer = (edit: Removal): RangeEditResult => ({
		source: edit.source,
		caret: caretOf(edit, read(edit), besideOf(gesture, doc, range), started)
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
		// A clipboard that carries the editor's own entry is the editor's own bytes: no transform runs.
		const transform: Pasted['transform'] =
			gesture.own === undefined ? (text, blocks) => host.transformPaste(text, blocks) : null;
		const pasted = (held: Held): Pasted => ({
			text: gesture.paste,
			plain: gesture.plain,
			held,
			transform
		});
		if (from === to) return answer(pasteAt(doc, from, to, pasted(gesture)));
		if (inOneText(doc, from, to)) return answer(pasteAt(doc, from, to, pasted(TEXT)));
		// Across blocks the paste lands where the removal's caret does, as a cut's then a paste's
		// would, and over one block held whole takes its place, as typed text does.
		const removed = removalEdit(doc, from, to, 'type');
		const after = read(removed);
		const caret = caretOf(removed, after, 'start after', () => startedIn(doc, from));
		const place = heldAlone(doc, from, to) ? TEXT : caret;
		return answer(pasteAt(after, caret.at, caret.at, pasted(place)));
	}
	const { removed, clipboard, own } = taken(doc, from, to);
	const { drop } = gesture;
	const dropped: Pasted = { text: clipboard, plain: false, held: TEXT, transform: null };
	if (gesture.copy) return answer(pasteAt(doc, drop, drop, dropped));
	// A moving drop is a cut, then a paste of its text and own entry at the drop point.
	const after = read(removed);
	const at = drop <= from ? drop : drop - (source.length - removed.source.length);
	return answer(restored(removed.source, at, at, own) ?? pasteAt(after, at, at, dropped));
}

const TEXT: Held = { holds: 'text' };

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

/** A leaf's last caret place: a fenced block's body end, else its text's end past a structural
 *  suffix the block draws after it (a setext underline). */
function lastCaretByte(doc: Doc, leaf: LaidBlock): number {
	const body = fenceBody(doc, leaf);
	if (body) return body.to;
	const node = nodeAt(doc, leaf.path);
	return byteAt(doc, leaf, getContentRange(node).end + structuralSuffix(node).length);
}
