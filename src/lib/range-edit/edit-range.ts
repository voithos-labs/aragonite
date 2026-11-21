/**
 * A gesture over a range of a Markdown document, answered in bytes: copy, cut, Backspace or Delete,
 * the removal a typed key, a composition or a command makes first, a paste, a drop. It reads the
 * document through `host` and returns the new bytes, where the caret lands and what a copy or a cut
 * puts on the clipboard; the editor applies the answer. The laws it keeps are `test/range-edit/laws.ts`.
 */

import { getContentRange, structuralSuffix } from '../core/inline';
import type { AnyBlockKind } from '../core/nodes';
import { shownKind } from '../core/parsers/heading';
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
	leafAt,
	leafHolding,
	lineOf,
	nodeAt,
	pointedBlock,
	readDoc,
	readsAsText,
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
import { entersOpening, removeLeavingBlank, removeRange, type Removal } from './removal';
import { fenceBody, holdsText, lastPlaceAt, literalBody } from './removal-range';

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
	/** Where text over the range would go, with nothing written: a composition's place, which the
	 *  IME then writes at, and a line break's, which the block then runs at. */
	| 'place'
	/** A typed key's or a soft keyboard's text: what a one-line paste of it writes at the place, with
	 *  no paste transform; text holding a line ending lands as that paste's lines do. */
	| { text: string }
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
	/** Set on a place that is an empty paragraph opened where the range was: Enter's whole answer. */
	opened?: true;
	/** For a key's text: the block it went into and the kind that block showed before it, which a
	 *  cue of a new kind compares against. */
	into?: { path: number[]; kind: AnyBlockKind };
}

export function editRange(
	source: string,
	range: Range,
	gesture: Gesture,
	mode: Mode,
	host: PasteHost
): RangeEditResult {
	if (typeof gesture !== 'object' || !('text' in gesture))
		return edited(source, range, gesture, mode, host, false);
	return edited(
		source,
		range,
		{ paste: gesture.text, plain: false, holds: 'text' },
		mode,
		host,
		true
	);
}

/** `editRange`, where `typed` says a paste stands for a key's text: it runs no paste transform and
 *  writes blank text where the range was, as typing it does. */
function edited(
	source: string,
	range: Range,
	gesture: Exclude<Gesture, { text: string }>,
	mode: Mode,
	host: PasteHost,
	typed: boolean
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
		caret: caretOf(edit, result, besideOf(gesture, doc, range), started, from)
	});
	if (gesture === 'copy' || gesture === 'cut') {
		const { removed, clipboard, own } = taken(doc, from, to);
		if (gesture === 'cut') return { ...answer(removed), clipboard, own };
		return { source, caret: { at: to, holds: 'text' }, clipboard, own };
	}
	if (gesture === 'place') return placeAnswer(doc, range);
	if (typeof gesture === 'string') return answer(removalEdit(doc, from, to, gesture));
	// A line ending landing on a last line that has none lands as on one that has, then the break
	// comes back off unless the line left last is blank (`syntax-tree.md` § The last line).
	const reclosed = (at: number, text: string): RangeEditResult | null => {
		if (!opensLastLine(doc, from, to, at, text)) return null;
		const closed = edited(source + doc.ending, range, gesture, mode, host, typed);
		const last = (body: string) => lastLineOf(readDoc(body, host, mode));
		// Literal text recloses where the line left last is the code's or blank: never over one with text.
		if (literalAt(doc, from, to, at) && last(closed.source) === 'text') return null;
		return reopened(closed, doc.ending, last);
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
		// A clipboard that carries the editor's own entry is the editor's own bytes, and a key's text
		// no clipboard's: no transform runs.
		const transform: Pasted['transform'] =
			gesture.own === undefined && !typed
				? (text, blocks) => host.transformPaste(text, blocks)
				: null;
		const pasted = (held: Held, inPlace?: true): Pasted => ({
			text: gesture.paste,
			plain: gesture.plain,
			held,
			transform,
			...(inPlace && { inPlace })
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
		// Across blocks the paste lands at the place text over the range takes, and over one block held
		// whole takes its place.
		const { removed, after, place, opens } = textPlace(doc, range, typed ? '' : gesture.paste);
		const into = typed ? { into: intoOf(after, place) } : {};
		// A key's blank text reads as no block, so a paste of it would go in at the first byte of the
		// block under the place: it takes the paragraph a line of its own opens instead.
		const blank = typed && opens && isBlankText(gesture.paste);
		const spaced = blank ? intoOpened(doc, after, place, gesture.paste) : null;
		if (spaced) return keepLastEnding({ ...landed(spaced), blocks: 0, ...into });
		const held = pasted(removed.inPlace ? TEXT : place, removed.inPlace);
		const pastedOver = pasteAt(after, place.at, place.at, held);
		// A key's one line that a paste would read as blocks at text (a marker) is that block's own
		// write instead, so the marker makes its kind there, as typing it does.
		const marker =
			typed && place.holds === 'text' && !!pastedOver.blocks && !/\n/.test(gesture.paste);
		const at = marker ? leafHolding(after, place.at, place.at) : null;
		const over = at ? writeText(after, at.leaf, at.from, at.to, gesture.paste) : pastedOver;
		return keepLastEnding({ ...landed(over), blocks: over.blocks ?? 0, ...into });
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

/** The removal a paste of `text` over `[from, to)` across blocks makes first: blank text leaves the
 *  place blank, as a cut does; other text goes in at once, as a typed character does (`inPlace`). */
function pasteRemoval(doc: Doc, from: number, to: number, text: string): Removal & PlaceKept {
	const alone = heldAlone(doc, from, to);
	const blank = text !== '' && isBlankText(text);
	const removed =
		alone && blank
			? blankedOut(doc, alone, to)
			: removalEdit(doc, from, to, blank ? 'cut' : 'type');
	return alone ? { ...removed, inPlace: true } : removed;
}

/** The place text over a range takes once a typed key's removal ran: before the end leaf's rest, on
 *  text the range left or a line it emptied, else a line of its own where the range was (`opens`). */
function textPlace(doc: Doc, range: Range, text: string | null) {
	const { from, to } = range;
	// A place nothing is written at yet removes as a key that writes nothing does.
	const removed: Removal & PlaceKept =
		text === null ? removalEdit(doc, from, to, 'compose') : pasteRemoval(doc, from, to, text);
	const after = { ...readDoc(removed.source, doc.host, doc.mode), ending: doc.ending };
	const started = () => startedIn(doc, from);
	const caret = caretOf(removed, after, besideOf('type', doc, range), started, from);
	// A block held whole gives its own line to the text: the caret is that line's.
	if (removed.inPlace) return { removed, after, place: caret, opens: false };
	const own = ownLine(doc, after, removed, caret, to, started);
	const place = own ? atGap(after, own) : onText(after, caret);
	return { removed, after, place, opens: own !== null };
}

/** `text` written in an empty paragraph opened at the boundary `place` of `after`; null where no
 *  paragraph opens there. */
function intoOpened(doc: Doc, after: Doc, place: Place, text: string): Edit | null {
	if (place.holds !== 'boundary') return null;
	const line = doc.host.openedAt(after.tree, place.parent, childAt(after, place));
	if (!line) return null;
	const opened = { ...readDoc(line.source, doc.host, doc.mode), ending: doc.ending };
	const held = leafHolding(opened, line.caret, line.caret);
	return held && writeText(opened, held.leaf, held.from, held.to, text);
}

/** The block text at `place` goes into, read on `doc` before it does: the leaf there, else the new
 *  paragraph a line of its own opens. */
function intoOf(doc: Doc, place: Place): { path: number[]; kind: AnyBlockKind } {
	const point = place.holds === 'text' ? doc.layout.leafAt(place.at) : null;
	if (point) return { path: point.path, kind: shownKind(nodeAt(doc, point.path)) };
	const parent = place.holds === 'text' ? [] : [...place.parent];
	return { path: [...parent, childAt(doc, { at: place.at, parent })], kind: 'paragraph' };
}

/** A line of its own at the byte the caret between blocks stands at there: the first byte of the
 *  block after it, past the blank lines above that block. */
function atGap(doc: Doc, own: Place): Place {
	if (own.holds === 'text') return own;
	const next = doc.layout.block([...own.parent, childAt(doc, own)]);
	return next ? { ...own, at: next.from } : own;
}

/** `caret`, or where it is a boundary text takes no line of its own at, the prose there a letter
 *  joins: a line it emptied, or text starting there; prose ending before it leaves it standing. */
function onText(doc: Doc, caret: Place): Place {
	if (caret.holds !== 'boundary') return caret;
	const point = doc.layout.leafAt(caret.at);
	const node = point && nodeAt(doc, point.path);
	const reads =
		node && doc.host.facts(node.kind).joins === 'text' && readsAsText(node, point.offset);
	const at = reads ? doc.layout.byteOf(point.path, point.offset) : null;
	if (at === null || (at < caret.at && !isBlankText(node!.raw))) return caret;
	return { at, holds: 'text' };
}

/** Where text opens a line of its own: a boundary the caret holds there, or where the start block
 *  stood when the removal took it and the caret is on no text the range left of its own. */
function ownLine(
	doc: Doc,
	after: Doc,
	removed: Removal,
	caret: Place,
	to: number,
	started: () => LaidBlock[]
): Place | null {
	if (caret.holds === 'boundary' && heldAsGap(after, caret)) return caret;
	const took = removed.took;
	if (took === undefined) return null;
	const own = restAfter(doc, to);
	if (own && caret.holds === 'text') return null;
	const point = after.layout.leafAt(caret.at);
	const leaf = point && nodeAt(after, point.path);
	const prose = !!point && caret.holds !== 'block' && (!leaf || readsAsText(leaf, point.offset));
	if (prose && (own || (!!leaf && isBlankText(leaf.raw)))) return null;
	if (joinedAcross(after, took)) return null;
	return { at: took, holds: 'boundary', parent: parentAt(after, took, started) };
}

/** Whether the text below joined a block above across byte `at`, so no boundary stands there. */
function joinedAcross(doc: Doc, at: number): boolean {
	const joined = doc.layout.leafAt(at);
	const across = joined && nodeAt(doc, joined.path);
	return !!across && joined.offset > 0 && joined.offset < across.raw.trimEnd().length;
}

/** Whether a caret holds the boundary `place` as a gap: at the document's end, else not where a
 *  letter typed there joins the prose the byte map reads it in, nor among a list's items. */
function heldAsGap(doc: Doc, place: { at: number; parent: readonly number[] }): boolean {
	const parent = doc.layout.block(place.parent);
	if (parent && factsOf(doc, parent).lines === 'items') return false;
	const below = findWithin(doc, place.at, doc.source.length, (b) => b.from >= place.at);
	if ((place.parent.length === 0 && !below) || place.at >= doc.source.length) return true;
	const point = doc.layout.leafAt(place.at);
	const inside = point && place.parent.every((index, depth) => point.path[depth] === index);
	const leaf = inside ? doc.layout.block(point.path) : undefined;
	if (!leaf) return true;
	return !(
		factsOf(doc, leaf).joins === 'text' && readsAsText(nodeAt(doc, leaf.path), point!.offset)
	);
}

/** The place a composition, a line break or a command takes over the range: the removal's bytes and
 *  the text place, or, where text would open a line of its own, an empty paragraph there. */
function placeAnswer(doc: Doc, range: Range): RangeEditResult {
	const alone = heldAlone(doc, range.from, range.to);
	const { removed, after, place, opens } = alone
		? goneAlone(doc, range)
		: textPlace(doc, range, null);
	const { source } = removed;
	const kept = onText(after, place);
	// The line a block held whole left blank in its container is the paragraph that would open there.
	const leaf = alone && kept.holds === 'text' ? after.layout.leafAt(kept.at) : null;
	if (leaf && isBlankText(nodeAt(after, leaf.path).raw))
		return { source, caret: kept, opened: true };
	if (!opens || place.holds !== 'boundary') return { source, caret: kept };
	// An emptied document keeps one empty paragraph: the one text would open there.
	if (isBlankText(source)) return { source, caret: { at: 0, holds: 'text' }, opened: true };
	const line = doc.host.openedAt(after.tree, place.parent, childAt(after, place));
	if (!line) return { source, caret: place };
	return { source: line.source, caret: { at: line.caret, holds: 'text' }, opened: true };
}

/** The place over one block held whole: the block gone with its line, as Backspace takes it, and a
 *  paragraph to open where it stood, unless prose below joined the block above there. */
function goneAlone(doc: Doc, range: Range) {
	const removed = removeLeavingBlank(doc, range.from, range.to);
	const after = { ...readDoc(removed.source, doc.host, doc.mode), ending: doc.ending };
	const took = removed.took ?? removed.caret;
	const parent = parentAt(after, took, () => startedIn(doc, range.from));
	const place: Place = { at: took, holds: 'boundary', parent };
	// Prose below that joined the block above there takes the composed text where it runs on.
	const runsOn = joinedAcross(after, took) && onText(after, place).holds === 'text';
	return { removed, after, place, opens: !runsOn };
}

/** The index among `place.parent`'s children of the first one starting at or past its byte. */
function childAt(doc: Doc, place: { at: number; parent: readonly number[] }): number {
	const { parent, at } = place;
	const holder = parent.length ? nodeAt(doc, parent) : doc.tree;
	// Children lie in byte order, so the search lays out a few of them, never every one before.
	let [low, high] = [0, holder.children?.length ?? 0];
	while (low < high) {
		const middle = (low + high) >> 1;
		if (doc.layout.block([...parent, middle])!.from < at) low = middle + 1;
		else high = middle;
	}
	return low;
}

/** Where a paste's removal left a block held whole its line for the text: the blank line under that
 *  line is the block's separator, never an empty row. */
interface PlaceKept {
	inPlace?: true;
}

/** Whether text ending in a line ending lands at `at` on a last line with none, in no literal
 *  text and over no range that empties the document, which has no last line to keep. */
function opensLastLine(doc: Doc, from: number, to: number, at: number, text: string): boolean {
	const { source } = doc;
	if (!source || ownTrailingLineEnding(source) || !asPasted(doc, at, at, text).endsWith('\n'))
		return false;
	if (from === 0 && to === source.length) return false;
	// The ending lands at the block's end where text is pasted in a block that holds more lines
	// (a setext underline): the last line is the block's, literal text's too.
	const leaf = leafHolding(doc, at, at)?.leaf;
	return !source.includes('\n', leaf ? contentEnd(doc, leaf) : at);
}

/** Whether `at` is in literal text the paste writes in, not a literal block held whole. */
function literalAt(doc: Doc, from: number, to: number, at: number): boolean {
	const held = leafHolding(doc, at, at);
	if (!held || factsOf(doc, held.leaf).body !== 'literal') return false;
	// A fence's closing line is no text of it.
	const fence = doc.host.fence(nodeAt(doc, held.leaf.path).raw);
	if (fence && fence.closer !== null && held.to >= fence.closer) return false;
	return !(at === to && heldAlone(doc, from, to));
}

/** `closed`, a paste into the document given the last line ending it lacked: the ending goes
 *  again unless the line left last is blank, which keeps it as Enter's does. */
function reopened(
	closed: RangeEditResult,
	eol: string,
	last: (source: string) => LastLine
): RangeEditResult {
	// The one write of a block was the closed document's.
	const result: RangeEditResult = { ...closed, leaf: undefined };
	const { source, caret } = result;
	if (!source.endsWith(eol)) return result;
	const body = source.slice(0, -eol.length);
	const line = body.lastIndexOf('\n') + 1;
	const kind = last(source);
	if (kind === 'text') {
		return { ...result, source: body, caret: { ...caret, at: Math.min(caret.at, body.length) } };
	}
	// A code block's empty last line is its own line: no paragraph opens under it.
	if (kind === 'literal') return result;
	// An empty last line right under a block's last line is Enter's empty paragraph there.
	const under = line > 0 && !isBlankText(body.slice(body.lastIndexOf('\n', line - 2) + 1, line));
	if (line < body.length || caret.at !== line || !under) return result;
	const at = line + eol.length;
	return { ...result, source: body + eol + eol, caret: { at, holds: 'text', line: true } };
}

/** What the last line of `doc`, which ends in a line ending, holds: blank is an empty block's (an
 *  empty item's or quote's paragraph) or an empty line; a container's own marker line is text. */
function lastLineOf(doc: Doc): LastLine {
	const { source } = doc;
	const end = source.length - ownTrailingLineEnding(source).length;
	const leaf = leafHolding(doc, end, end)?.leaf;
	const text = leaf?.text && source.slice(leaf.text.from, leaf.text.to);
	if (text === undefined) {
		const line = source.slice(source.lastIndexOf('\n', end - 1) + 1, end);
		return /^\r?$/.test(line) ? 'blank' : 'text';
	}
	// Literal text's last line is a line of its own, its other lines no matter.
	if (factsOf(doc, leaf!).body !== 'literal') return isBlankText(text) ? 'blank' : 'text';
	return isBlankText(text.slice(text.lastIndexOf('\n') + 1)) ? 'literal' : 'text';
}

/** A last line with text, a blank one, or a code block's empty last line. */
type LastLine = 'text' | 'blank' | 'literal';

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
 *  the bytes after. `own` where some of the leaf the range ended in follows it, the one text that
 *  text written over the range may join. */
export interface RemovalAnswer extends RangeEditResult {
	taken?: { at: number; parent: readonly number[]; own: boolean };
	/** The byte the removal left its caret at before it landed: where a cut's own entry fits. */
	unlanded: number;
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

/** Where Backspace at the start of the block at byte `at`, or Delete at the end of the one before
 *  it, lands when it joins nothing: the place a removal's caret takes on that side. */
export function besideEdge(
	source: string,
	at: number,
	gesture: 'backspace' | 'delete',
	mode: Mode,
	host: RangeHost
): Place | null {
	const doc = readDoc(source, host, mode);
	return gesture === 'backspace' ? endBefore(doc, at) : startAfter(doc, at, at);
}

/** A removal of the blocks `range` spans as blocks asked for (the block menu's Delete), not text:
 *  `Doc.wholeBlocks` says what that changes. */
export function wholeBlocksRemovalOf(
	source: string,
	range: Range,
	gesture: RemovalGesture,
	mode: Mode,
	host: RangeHost
): RemovalAnswer {
	const doc = { ...readDoc(source, host, mode), wholeBlocks: true };
	return answerOf(removeLeavingBlank(doc, range.from, range.to), gesture, doc, range);
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
	const caret = caretOf(removed, result, besideOf(gesture, doc, range), started, from);
	const at = removed.took;
	const unlanded = removed.caret;
	if (at === undefined) return { source: removed.source, caret, unlanded };
	const own = restAfter(doc, range.to);
	return {
		source: removed.source,
		caret,
		unlanded,
		taken: { at, parent: parentAt(result, at, started), own }
	};
}

/** Whether byte `to` sits in a leaf's text with some of that text after it, in a leaf the range
 *  entered or prose it ended at the first byte of: anywhere else that byte is the leaf's syntax. */
function restAfter(doc: Doc, to: number): boolean {
	const end = leafAt(doc, to)?.leaf;
	// A fenced block's text is its body; its closing line is no rest.
	const textEnd = end && (fenceBody(doc, end)?.to ?? end.text?.to);
	if (!end || textEnd === undefined || isBlankText(doc.source.slice(to, textEnd))) return false;
	const facts = factsOf(doc, end);
	// A leaf drawn from its source takes a caret in its text only while that source shows.
	if (facts.textPosition !== 'always') return false;
	return end.from < to || facts.body === 'markdown';
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

/** Where a caret goes beside blocks the range took whole, no text left at its start: the end before,
 *  the text or first byte after, or the gap above a block it entered. */
type Beside = 'end before' | 'text after' | 'cut' | 'gap above';

function besideOf(gesture: Gesture, doc: Doc, range: Range): Beside {
	if (gesture === 'backspace' || gesture === 'command') return 'end before';
	// Typed or composed text joins the text after only where that text is the end leaf's own, and
	// elsewhere opens its paragraph where a cut's paste would go back.
	if (gesture === 'type' || gesture === 'compose')
		return entersAtEnd(doc, range) ? 'text after' : 'cut';
	// A cut's paste goes back above the opening the range entered, a title or a header included.
	if (gesture === 'cut') return entersOpening(doc, range.from, range.to) ? 'gap above' : 'cut';
	return gesture === 'delete' ? 'text after' : 'cut';
}

/** Whether the range ends before the end of a leaf that starts inside it, so that leaf's text
 *  follows the caret, not a block the range never reached. */
const entersAtEnd = (doc: Doc, { from, to }: Range): boolean =>
	findWithin(
		doc,
		to,
		to,
		(b) => !!b.text && from <= b.from && b.from < to && to < contentEnd(doc, b)
	) !== undefined;

/** What a removal gesture leaves: text typed over one block held whole takes its place, and the
 *  line stays; text typed elsewhere goes in at once, so the line it lands on is never left blank. */
function removalEdit(doc: Doc, from: number, to: number, gesture: RemovalGesture): Removal {
	if (gesture !== 'type') return removeLeavingBlank(doc, from, to);
	if (!heldAlone(doc, from, to)) return removeRange(doc, from, to);
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
	const removed = removeLeavingBlank(doc, from, to);
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

/** The caret of a range from byte `from`, named by what the new bytes hold there: text, a block
 *  start or a boundary, or where no text stayed, the side `beside` names. */
function caretOf(
	edit: Removal,
	result: Doc,
	beside: Beside,
	started: () => LaidBlock[],
	from: number
): Place {
	const { after } = edit;
	const at = edit.caret;
	const boundary = (): Place => ({
		at,
		holds: 'boundary',
		parent: parentAt(result, at, started, edit.parent)
	});
	const side =
		after === undefined
			? null
			: beside === 'end before'
				? (endBefore(result, at) ?? startAfter(result, at, after))
				: beside === 'text after'
					? startAfter(result, at, after)
					: (beside === 'gap above' && gapBefore(result, at)) || firstPlace(result, at);
	if (side) return side;
	let text = at;
	const lineStart = edit.source.lastIndexOf('\n', at - 1) + 1;
	while (text > lineStart && !result.layout.pointAt(text)) text--;
	// A removal that left the caret before where the range started left it at the end of a block
	// the range never reached, which a landing asks as it asks any block before.
	const before = at < from;
	if (edit.source === '' || result.layout.pointAt(text))
		return (before && pastSyntax(result, text)) || { at: text, holds: 'text' };
	const block = findWithin(result, at, at, (b) => b.from === at);
	if (block) return { at, holds: 'block', parent: block.path.slice(0, -1) };
	return boundary();
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

/** The end of the block before byte `at` (`textEdge`): under a title row that is all name, the
 *  boundary inside its container, and past a block with no text place, the boundary after it. */
function endBefore(doc: Doc, at: number): Place | null {
	for (let byte = at - 1; byte >= 0; byte--) {
		const block = pointedBlock(doc, byte);
		if (!block) continue;
		const edge = textEdge(doc, block, 'last');
		if (!edge) return besideLeaf(doc, block, at);
		if (edge.holds !== 'text') return edge;
		// A caret ends after a character, and before a line ending, both bytes of a pair.
		const { source } = doc;
		const end = !/[\r\n]/.test(source[byte])
			? byte + 1
			: source[byte - 1] === '\r'
				? byte - 1
				: byte;
		return { at: Math.min(end, edge.at), holds: 'text' };
	}
	return null;
}

/** The place beside `leaf`, which has no text place: under a title row that is all name, inside
 *  its container, else the boundary after the leaf. */
function besideLeaf(doc: Doc, leaf: LaidBlock, at: number): Place {
	const owner = titleOwner(doc, leaf);
	return owner ? underRow(owner, leaf, at) : { at, ...held('boundary', leaf) };
}

/** The place past a leaf with no text place that ends at byte `at`, where a removal left the caret
 *  on the line before the block it took; null at any other byte. */
function pastSyntax(doc: Doc, at: number): Place | null {
	const leaf = pointedBlock(doc, at);
	if (!leaf || contentEnd(doc, leaf) !== at || textEdge(doc, leaf, 'last')) return null;
	return besideLeaf(doc, leaf, at);
}

/** The first or last place in `leaf` a letter renames or re-kinds nothing: its text or fenced body,
 *  the leaf itself where no caret goes in (a rule); null for a row all name or a bodiless picture. */
function textEdge(doc: Doc, leaf: LaidBlock, side: 'first' | 'last'): Place | null {
	const facts = factsOf(doc, leaf);
	if (facts.textPosition === 'never') return { at: leaf.from, ...held('block', leaf) };
	const body = literalBody(doc, leaf);
	if (body) return { at: side === 'first' ? body.from : body.to, holds: 'text' };
	const owner = titleOwner(doc, leaf);
	if (facts.textPosition !== 'always' || (owner && joinsName(doc, owner, leaf, leaf.text!.from)))
		return null;
	return { at: side === 'first' ? leaf.text!.from : lastCaretByte(doc, leaf), holds: 'text' };
}

/** Where a cut's caret goes, at the first byte of what follows where its paste goes back: text on
 *  that block's first line, never a literal body, the block where no caret goes in, else the gap. */
function firstPlace(doc: Doc, at: number): Place | null {
	const leaf = pointedBlock(doc, at);
	if (leaf?.from !== at) return null;
	const edge = literalBody(doc, leaf) ? null : textEdge(doc, leaf, 'first');
	const lineEnd = doc.source.indexOf('\n', at);
	if (edge && (edge.holds !== 'text' || lineEnd < 0 || edge.at <= lineEnd)) return edge;
	return gapBefore(doc, at);
}

/** The gap before the outermost block starting at byte `at`; null where none starts there. */
function gapBefore(doc: Doc, at: number): Place | null {
	const outer = findWithin(doc, at, at, (b) => b.from === at);
	return outer ? { at, ...held('boundary', outer) } : null;
}

/** The boundary under `owner`'s title row `row`, inside the container, at byte `at`. */
function underRow(owner: LaidBlock, row: LaidBlock, at: number): Place {
	// A block removed past the container's closing line still lands inside, under the row.
	const line = lineOf(owner, at);
	const closes = line.own && line.from > row.from;
	return { at: closes ? Math.min(at, line.from) : at, holds: 'boundary', parent: owner.path };
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
	// A title row that is all name sends the caret on into its container's body, never past it.
	let row: LaidBlock | undefined;
	for (let byte = from; byte < (entered?.to ?? doc.source.length); byte++) {
		const block = pointedBlock(doc, byte);
		if (!block || block.from < from) continue;
		const owner = row && titleOwner(doc, row);
		if (owner && block.from >= owner.to) return underRow(owner, row!, row!.to);
		const edge = textEdge(doc, block, 'first');
		if (edge) return edge;
		if (!titleOwner(doc, block)) return { at: block.from, ...held('boundary', block) };
		row = block;
		byte = block.to - 1;
	}
	const owner = row && titleOwner(doc, row);
	if (owner) return underRow(owner, row!, row!.to);
	return entered ? { at: after, holds: 'boundary', parent: entered.path } : null;
}

/** A leaf's last caret place before its line ending, past a structural suffix it draws after its
 *  text (a setext underline). */
function lastCaretByte(doc: Doc, leaf: LaidBlock): number {
	const node = nodeAt(doc, leaf.path);
	return byteAt(doc, leaf, getContentRange(node).end + structuralSuffix(node).length);
}
