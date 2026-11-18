// The laws as checks over the package's answers alone: each takes the package, the host and one
// input, and returns a line per broken law. A check that can't decide (the package declined, the
// shape is one the rows hold) says nothing.

import { ownTrailingLineEnding } from '#lib/core/lines.js';
import { sharedPrefixLength, sharedSuffixLength } from '#lib/core/written-span.js';
import type {
	Gesture,
	Held,
	Place,
	Range,
	RangeEditResult as Result
} from '#lib/range-edit/edit-range.js';
import type { Mode } from '#lib/range-edit/host.js';
import type { LaidBlock } from '#lib/range-edit/layout.js';
import type { CheckHost } from './test-host';
import { gluedStart, movedLine } from './kept-lines';
import {
	blankTail,
	endingOf,
	expectedCopy,
	expectedPaste,
	fenceOf,
	holdsShownText,
	inTitleRow,
	leafAt,
	leavesLiteralBlock,
	liveCutAt,
	inConstructAt,
	cellAt,
	containersHolding,
	reopensNowhere,
	lf,
	liveSplitsRun,
	aboveLine,
	overEmptied,
	startsLaterLine,
	opensWithoutClosing,
	mixedEndings,
	plainPasteHolds,
	readOf,
	sameBlocks,
	sameDocument,
	shownDelimiters,
	copiesLinesBeforeRange,
	unboxedAt,
	endsInListBeside,
	takesOtherGlyph,
	type Read
} from './expected';

export interface RangeInput {
	source: string;
	mode: Mode;
	range: Range;
}

/** A paste at a caret; `held` is `'text'` for a drawn one, else what the cut that left it said. */
export interface CaretInput {
	source: string;
	mode: Mode;
	at: number;
	held: Held;
	text: string;
}

/** A call the package may not answer (the recorded editor, say): undefined skips the law. */
export type Call = (
	source: string,
	range: Range,
	gesture: Gesture,
	mode: Mode
) => Result | undefined;

const q = (text: string) => JSON.stringify(text);
const caretRange = (at: number): Range => ({ from: at, to: at });
const TEXT: Held = { holds: 'text' };
const paste = (text: string, held: Held = TEXT): Extract<Gesture, { paste: string }> => ({
	...held,
	paste: text,
	plain: false
});
/** What a caret an answer left holds, apart from its byte. */
export const heldBy = (caret: Place): Held =>
	caret.holds === 'text' ? TEXT : { holds: caret.holds, parent: caret.parent };

// ── Shapes the laws treat apart ──────────────────────────────────────────────

/** The block other than a paragraph the range holds exactly, from its first byte to the end of its
 *  last line's text: it goes whole, and typing or a paste over it takes its place. */
export function blockHeldWhole(read: Read, range: Range) {
	return (
		read.blocks.find(
			(b) =>
				b.type !== 'paragraph' &&
				b.from === range.from &&
				b.to - endingLength(read.source, b.to) === range.to &&
				range.from < range.to
		) ?? null
	);
}

function endingLength(source: string, to: number): number {
	return source.slice(to - 2, to) === '\r\n' ? 2 : source[to - 1] === '\n' ? 1 : 0;
}

/** A cut from a heading's text start that reads as a block alone, the whole text or not: at that
 *  text start it pastes back as blocks, never as the heading's text; the own entry gives the source. */
export function headingTextReadsAsBlock(read: Read, range: Range, host: CheckHost): boolean {
	const heading = read.blocks.find(
		(b) =>
			b.text?.from === range.from &&
			range.to <= b.text.to &&
			b.from < b.text.from &&
			host.facts(b.type).joins !== 'text'
	);
	const text = lf(read.source.slice(range.from, range.to));
	return !!heading && range.from < range.to && readOf(host, text).blocks[0]?.type !== 'paragraph';
}

/** A range inside one block's text covering all of it, in live mode: the owner's rule there is that
 *  deleting the whole text leaves a paragraph, so a paste back gives the text as a paragraph. */
export function liveWholeText(read: Read, range: Range, mode: Mode): boolean {
	if (mode !== 'live') return false;
	return read.blocks.some(
		(b) =>
			b.text &&
			b.text.from >= range.from &&
			b.text.to <= range.to &&
			b.from <= range.from &&
			range.to <= b.to &&
			b.text.from < b.text.to
	);
}

/** In live mode, whether a construct holds an end of the range and the bytes the range carries out
 *  close it: there a paste back can't give the bytes back, and one write closes the run its own way. */
function cutsLiveRun(read: Read, { from, to }: Range, host: CheckHost): boolean {
	const held = [from, to].some((at) => inConstructAt(read, at, host));
	return held && liveSplitsRun(read, from, to, host);
}

// ── The laws ─────────────────────────────────────────────────────────────────

/** L1: a copy and a cut of one range write the same clipboard. L2: a copy changes no byte. */
export function copyLaws(call: Call, input: RangeInput): string[] {
	const out: string[] = [];
	const copy = call(input.source, input.range, 'copy', input.mode);
	const cut = call(input.source, input.range, 'cut', input.mode);
	if (copy && copy.source !== input.source)
		out.push(`L2 copy changed the source to ${q(copy.source)}`);
	if (copy && cut && copy.clipboard !== cut.clipboard)
		out.push(`L1 copy wrote ${q(copy.clipboard ?? '')}, cut ${q(cut.clipboard ?? '')}`);
	if (copy && cut && copy.own !== cut.own)
		out.push(`L1 copy wrote its own entry ${q(copy.own ?? '')}, cut ${q(cut.own ?? '')}`);
	return out;
}

/** L12: with its own entry, a cut pasted back is exact and a range's copy pasted over it changes
 *  nothing; at another caret the entry reads as the text alone would. */
export function ownEntry(call: Call, host: CheckHost, input: RangeInput, at: number): string[] {
	const { source, range, mode } = input;
	const out: string[] = [];
	const withOwn = (r: Result, held: Held = TEXT): Gesture => ({
		...paste(lf(r.clipboard ?? ''), held),
		own: r.own
	});
	const cut = call(source, range, 'cut', mode);
	if (cut?.clipboard !== undefined) {
		const back = call(cut.source, caretRange(cut.caret.at), withOwn(cut, heldBy(cut.caret)), mode);
		if (back && back.source !== source)
			out.push(`L12 cut ${q(cut.source)}, pasted back with its entry ${q(back.source)}`);
	}
	const copy = call(source, range, 'copy', mode);
	if (copy?.clipboard === undefined) return out;
	const over = call(source, range, withOwn(copy), mode);
	if (over && over.source !== source)
		out.push(`L12 its own copy pasted over the range gave ${q(over.source)}`);
	const rowFrom = source.lastIndexOf('\n', range.from - 1) + 1;
	const breakAt = source.indexOf('\n', range.to);
	const covered = (breakAt < 0 ? source.length : breakAt) - rowFrom;
	if ((copy.own ?? '').length > covered + 1024)
		out.push(`L12 its own entry holds ${(copy.own ?? '').length} bytes for ${covered} covered`);
	const there = call(source, caretRange(at), withOwn(copy), mode);
	const plain = call(source, caretRange(at), paste(copy.clipboard), mode);
	if (there && plain && !sameBlocks(host, there.source, plain.source))
		out.push(`L12 at ${at} with its entry ${q(there.source)}, its text alone ${q(plain.source)}`);
	return out;
}

/** L3: a cut, then a paste of what it wrote at the caret it left, gives the source back, save the
 *  exceptions the spec's section 4 declares. */
export function cutPasteBack(call: Call, host: CheckHost, input: RangeInput): string[] {
	const read = readOf(host, input.source);
	if (liveWholeText(read, input.range, input.mode)) return [];
	if (input.mode === 'live' && cutsLiveRun(read, input.range, host)) return [];
	if (opensWithoutClosing(read, input.range.from, input.range.to, host)) return [];
	if (leavesLiteralBlock(read, input.range.from, input.range.to, host, input.mode)) return [];
	if (copiesLinesBeforeRange(read, input.range.from, host)) return [];
	if (headingTextReadsAsBlock(read, input.range, host)) return [];
	const cut = call(input.source, input.range, 'cut', input.mode);
	if (!cut || cut.clipboard === undefined) return [];
	// A live caret beside three delimiters in a row: no cut of the run there is sound.
	if (input.mode === 'live' && crowded(readOf(host, cut.source), cut.caret.at)) return [];
	// The editor hands a paste its text with LF line endings.
	const text = lf(cut.clipboard);
	// Where law 9 pins a paste in text to other bytes (one line after text is text), law 9 wins and
	// the own entry gives them back. At a caret between blocks the paste back is compared.
	const held = heldBy(cut.caret);
	const want = expectedPaste(readOf(host, cut.source), cut.caret.at, text, host, held);
	const { from, to } = input.range;
	const whole =
		read.blocks.some((b) => b.from === from) &&
		read.blocks.some((b) => b.to - endingLength(input.source, b.to) === to);
	// On an empty line the paste back is compared too: law 9 only says where its blocks stand.
	const pinned =
		want.shape !== 'other' && want.shape !== 'on a line' && !(want.shape === 'apart' && whole);
	if (pinned && held.holds === 'text' && !want.bytes.includes(input.source)) return [];
	// In a list item a clipboard's leading line endings are Enter (rulings 34 and 79): a cut taken
	// from an item's text end on pastes back as a new item, which `paste-leading-enter` rows hold.
	const caretIn = containersHolding(readOf(host, cut.source), cut.caret.at).at(-1);
	if (held.holds === 'text' && caretIn?.type === 'listItem' && /^\n+[^]*\S/.test(text)) return [];
	// A cut that leaves its caret in a cell: the cell holds one line, which law 9 holds there.
	if (held.holds === 'text' && cellAt(readOf(host, cut.source), cut.caret.at, host)) return [];
	// A part of one block's text cut out, the caret left in no text: pasted there, it is no part of
	// that block.
	if (cut.caret.holds !== 'text' && !whole && oneTextBlock(read, input.range, host)) return [];
	const back = call(cut.source, caretRange(cut.caret.at), paste(text, held), input.mode);
	if (!back) return [];
	// Mixed line endings compare as LF, the range's offsets counted in the same bytes.
	const norm = mixedEndings(input.source) ? lf : (bytes: string) => bytes;
	const [source, got] = [norm(input.source), norm(back.source)];
	if (got === source) return [];
	const at = (byte: number) => norm(input.source.slice(0, byte)).length;
	// Plain text can't carry how each covered line spelled its markers: the same blocks will do.
	if (sameDocument(host, source, got, at(from), at(to))) return [];
	// A block taken whole takes a blank line beside it, which plain text can't give back (spec § 4).
	const taken = source.length - norm(cut.source).length - (at(to) - at(from));
	if (taken > endingOf(source).length && sameBlocks(host, source, got)) return [];
	return [`L3 cut ${q(cut.source)}, pasted back ${q(back.source)}`];
}

/** A removal keeps the bytes before the range, the end line's text and the lines after (§ 5.2);
 *  live mode, whose rules rewrite format runs at the edges, is held to the bytes before, runs aside. */
export function keepsOutside(call: Call, host: CheckHost, input: RangeInput): string[] {
	const { source } = input;
	const { from, to } = input.range;
	const read = readOf(host, source);
	if (liveWholeText(read, input.range, input.mode)) return [];
	const lineGoes = startLineGoes(read, input.range);
	const point = read.layout.pointAt(to);
	const leaf = point && read.blocks.find((b) => b.path.join() === point.path.join());
	const breakAt = source.indexOf('\n', to);
	const textStop = Math.min(leaf?.text?.to ?? to, breakAt < 0 ? source.length : breakAt);
	const tail =
		input.mode === 'source' && leaf?.text && to >= leaf.text.from
			? source.slice(to, textStop).trimEnd()
			: '';
	const out: string[] = [];
	for (const key of ['cut', 'backspace', 'delete'] as const) {
		const got = call(source, input.range, key, input.mode);
		if (!got) continue;
		const runless = (text: string) => (input.mode === 'live' ? text.replace(/[*_~`]/g, '') : text);
		const parted = withoutLineAbove(source, from, got.source);
		const kept = [from, lineGoes].some((at) =>
			runless(parted).startsWith(runless(source.slice(0, at)))
		);
		if (!kept || (tail !== '' && got.source.indexOf(tail, from) < 0))
			out.push(`L4 ${key} changed bytes outside the range: ${q(got.source)}`);
		const glued = input.mode === 'source' && gluedStart(host, read, from, to, got.source);
		const moved = glued || movedLine(host, read, from, to, got.source);
		if (moved) out.push(`L4 ${key} ${moved}: ${q(got.source)}`);
	}
	return out;
}

/** `got` less a blank line a removal put right above `from`'s line, where it left that line blank:
 *  the start's block stays a block of its own under the one above (an emptied item's list). */
function withoutLineAbove(source: string, from: number, got: string): string {
	const line = source.lastIndexOf('\n', from - 1) + 1;
	const blank = /^[ \t>]*\r?\n/.exec(got.slice(line))?.[0];
	if (!blank || /^[ \t>]*\r?\n/.test(source.slice(line))) return got;
	// The start's line under it holds its markers alone, an item's last.
	const left = /^[^\n]*/.exec(got.slice(line + blank.length))![0];
	const emptied = /^[ \t>]*(?:[-*+]|\d{1,9}[.)])[ \t]*\r?$/.test(left);
	return emptied ? got.slice(0, line) + got.slice(line + blank.length) : got;
}

/** What takes the blank line a removal put above `from`'s line out of bytes built on that removal,
 *  where it left the line blank (`withoutLineAbove`); null where it put none. */
function lineAboveOf(source: string, from: number, removal: string) {
	const width = removal.length - withoutLineAbove(source, from, removal).length;
	const line = source.lastIndexOf('\n', from - 1) + 1;
	return width === 0 ? null : (bytes: string) => bytes.slice(0, line) + bytes.slice(line + width);
}

/** `from`'s line start where its block goes whole out of its container at a line's end, a block
 *  right above that line and a blank line or the document's end below it; else `from` (§ 5.2). */
function startLineGoes(read: Read, { from, to }: Range): number {
	const { source } = read;
	const end = (b: LaidBlock) => b.to - endingLength(source, b.to);
	const blank = (line: string) => /^[ \t>]*\r?$/.test(line);
	const above = source.slice(0, from).split('\n');
	const head = above.pop()!;
	const first = read.blocks.find((b) => b.from === from && b.type !== 'paragraph');
	const parent = first && read.layout.block(first.path.slice(0, -1));
	if (!first || !parent || first.path.at(-1) === 0) return from;
	if (end(first) > to || end(parent) > to || head === '' || !blank(head)) return from;
	const below = /^\r?\n([^\n]*)/.exec(source.slice(to))?.[1];
	if (below === undefined || !blank(below) || blank(above.at(-1) ?? '')) return from;
	return head.trimEnd().startsWith(below.trimEnd()) ? from - head.length : from;
}

/** L4: Backspace and Delete over a range leave the bytes a cut leaves. */
export function deleteLaws(call: Call, input: RangeInput): string[] {
	const cut = call(input.source, input.range, 'cut', input.mode);
	if (!cut) return [];
	const out: string[] = [];
	for (const key of ['backspace', 'delete'] as const) {
		const got = call(input.source, input.range, key, input.mode);
		if (got && got.source !== cut.source)
			out.push(`L4 ${key} left ${q(got.source)}, the cut ${q(cut.source)}`);
	}
	return out;
}

/** `bytes` with every ordered item's number that opens a line read as one digit. */
const numbersAside = (bytes: string) =>
	bytes.replace(/^([ \t>]*)\d{1,9}(?=[.)][ \t\r\n])/gm, (_, lead: string) => `${lead}0`);

/** `then`, a paste after the cut, is `over`, the one gesture's answer, save in line endings where
 *  the cut took the source's first: `over` writes that one, `then` the one it finds, LF for none. */
function sameAfterCut(then: string, over: string, source: string, cut: string): boolean {
	const ending = endingOf(source);
	// A range to the end of a document with no last line ending leaves a cut that ends in one,
	// which a paste keeps: the paste over the range keeps the open last line instead.
	const closed = ownTrailingLineEnding(cut);
	if (closed && !ownTrailingLineEnding(source) && then === over + closed) return true;
	if (ending === endingOf(cut)) return then === over;
	// With no line ending left, every one in `then` is the paste's own.
	return cut.includes('\n') ? lf(then) === lf(over) : lf(then).replace(/\n/g, ending) === over;
}

/** The text block whose text holds the whole range, between its fence lines where it has them: a
 *  paste over the range is one write of that block, which keeps its kind and its other lines. */
export function oneTextBlock(read: Read, range: Range, host: CheckHost): LaidBlock | null {
	const { from, to } = range;
	const leaf = leafAt(read, from);
	if (!leaf || from === to || leaf !== leafAt(read, to) || blockHeldWhole(read, range)) return null;
	const fence = inTitleRow(read, from, host) ? null : fenceOf(read, leaf, host);
	const at = (byte: number) => read.layout.pointAt(byte)!.offset;
	const inBody =
		!fence || (at(from) >= fence.body && (fence.closer === null || at(to) < fence.closer));
	return inBody ? leaf : null;
}

/** Whether `text` is paragraphs alone and `block` prose that takes them as lines of its own: no
 *  cell, no title row, no literal text. */
function joinsProse(read: Read, block: LaidBlock, text: string, host: CheckHost): boolean {
	const parent = read.blocks.find((b) => b.path.join() === block.path.slice(0, -1).join());
	return (
		host.facts(block.type).body === 'markdown' &&
		!inTitleRow(read, block.text!.from, host) &&
		(!parent || host.facts(parent.type).lines !== 'cells') &&
		readOf(host, text).blocks.every((b) => b.type === 'paragraph')
	);
}

/** Law 5 inside one block's text: where the cut leaves the block whole, of its kind, the paste over
 *  is the cut then the paste; where the cut would read it otherwise, the bytes outside the range stay. */
function oneWrite(
	host: CheckHost,
	input: RangeInput,
	block: LaidBlock,
	text: string,
	results: { over: Result; cut: Result; then: Result | undefined; flat: () => Result | undefined }
): string[] {
	const { over, cut, then } = results;
	const { from, to } = input.range;
	const { source } = input;
	const read = readOf(host, source);
	// The cut of a setext title's whole text leaves its underline a line of its own, so the cut
	// then the paste is no guide there: the rows hold the bytes.
	const allText = block.text!.from === from && block.text!.to === to;
	const end = block.to - endingLength(source, block.to);
	const underlined = block.from === from && source.slice(to, end).trim() !== '';
	if (allText && underlined) return [];
	// Blocks pasted over a heading's whole text answer as the cut then the paste. A live cut leaves
	// a paragraph and a place between blocks, no guide: there the answer is the source mode's.
	const blocks = readOf(host, lf(text)).blocks[0]?.type !== 'paragraph';
	if (allText && block.from < from && blocks) {
		const live = input.mode === 'live';
		const want = live ? (/[*_`~[\]<]/.test(text) ? undefined : results.flat()) : then;
		if (!want || (live && want.source === over.source)) return [];
		return !live && sameAfterCut(want.source, over.source, source, cut.source)
			? []
			: [`L5 paste over a heading gave ${q(over.source)}, not ${q(want.source)}`];
	}
	const runless = (bytes: string) => (input.mode === 'live' ? bytes.replace(/[*_~`]/g, '') : bytes);
	const [got, before, after] = [over.source, source.slice(0, from), source.slice(to)].map(runless);
	// A last line ending in an ordered item is Enter, which numbers the items under it on.
	const numbered = /\n$/.test(text) && inItemText(read, from, host);
	const tail = numbered ? numbersAside : (bytes: string) => bytes;
	const kept = got.startsWith(before) && tail(got).endsWith(tail(after));
	// Blocks pasted from a later line's start cut the block there, and the first half ends before
	// the line break above, as a split's does.
	const cutAbove =
		startsLaterLine(read, block, from) &&
		got.startsWith(runless(aboveLine(source, from))) &&
		got.endsWith(after);
	// One write closes a format run a live range cuts another way than a cut then a paste: there
	// the bytes outside the range stay and the block keeps its kind.
	const cutsRun = input.mode === 'live' && cutsLiveRun(read, input.range, host);
	// A list that breaks out splits the caret's list around the range as law 9 says: an item with no
	// text left on either side gives way, its marker with it.
	const out = cutsRun ? null : expectedPaste(read, from, text, host, TEXT, to);
	if (out?.shape === 'broken out')
		return out.bytes.includes(over.source)
			? []
			: [`L5 a list breaking out over a range gave ${q(over.source)}, not ${q(out.bytes[0])}`];
	// Where a construct that splits whole (an autolink) holds an end, the paste lands at its edge,
	// outside the range, and the cut then the paste holds it.
	const moves =
		input.mode === 'live' && [from, to].some((at) => liveCutAt(read, at, host) === 'whole');
	// Paragraphs pasted into prose join the text either side, whatever a cut then a paste would give:
	// the bytes outside the range stay, and the lines between are the clipboard's, none added.
	if (joinsProse(read, block, text, host) && !cutsRun && !moves) {
		if (!kept)
			return [`L5 paste over text in one block changed bytes outside it: ${q(over.source)}`];
		const lines = (bytes: string) => bytes.split('\n').length;
		const mid = got.slice(before.length, got.length - after.length);
		// The container's empty line, and a closing line's blank line, a last line ending writes.
		const extra = lines(mid) - lines(text);
		const blanks = lf(mid)
			.split('\n')
			.slice(-extra - 1);
		const opened = /\n$/.test(text) && extra > 0 && extra <= 2 && containerLines(blanks, after);
		// At the end of a file with no last line break, the ending opens Enter's empty paragraph.
		const ended = /\n$/.test(text);
		const open = ended && after === '' && !/\n$/.test(source);
		const atOpenEnd = open && lf(mid) === lf(text) + '\n\n';
		// In an item there the ending is Enter's next item, an empty last line that keeps its break.
		const itemAtOpenEnd =
			open && /\n$/.test(mid) && lines(mid) === lines(text) + 1 && inItemText(read, from, host);
		if (lines(mid) !== lines(text) && !opened && !atOpenEnd && !itemAtOpenEnd)
			return [`L5 paste over text in one block added a line: ${q(over.source)}`];
	}
	if (then && sameAfterCut(then.source, over.source, source, cut.source)) return [];
	const lineStart = Math.max(source.lastIndexOf('\n', from - 1) + 1, block.text!.from);
	const lineEnd = Math.min((source + '\n').indexOf('\n', to), block.text!.to);
	const emptiesLine = (source.slice(lineStart, from) + source.slice(to, lineEnd)).trim() === '';
	const left = readOf(host, cut.source).blocks.find((b) => b.from === block.from);
	const whole = !emptiesLine && left?.type === block.type && left.to === block.to - (to - from);
	if (whole && !cutsRun)
		return [`L5 paste over gave ${q(over.source)}, cut then paste ${q(then?.source ?? '')}`];
	// A line that could close the fence around literal text grows the fence, which the rows hold.
	const fence = fenceOf(read, block, host);
	if (fence && text.split('\n').some((line) => fence.mayClose(line))) return [];
	if (!kept && !cutAbove)
		return [`L5 paste over text in one block changed bytes outside it: ${q(over.source)}`];
	const kindAt = (bytes: string | undefined) =>
		bytes === undefined
			? undefined
			: readOf(host, bytes).blocks.find((b) => b.from === block.from && !b.linesIn)?.type;
	const kinds = [block.type, kindAt(then?.source)];
	return !(whole && cutsRun) || kinds.includes(kindAt(over.source))
		? []
		: [`L5 paste over a cut run changed its block’s kind: ${q(over.source)}`];
}

/** L5: a paste over a range is the cut then the paste, or one write of the block whose text holds
 *  it; a typed character, a composition and a command remove as the cut, Delete and Backspace do. */
export function replaceLaws(
	call: Call,
	host: CheckHost,
	input: RangeInput,
	text: string
): string[] {
	const out: string[] = [];
	const read = readOf(host, input.source);
	const unit = blockHeldWhole(read, input.range);
	const over = call(input.source, input.range, paste(text), input.mode);
	const cut = call(input.source, input.range, 'cut', input.mode);
	// Text typed or pasted there at once leaves no blank line where the cut's empties a first line.
	const apart = cut && lineAboveOf(input.source, input.range.from, cut.source);
	const atOnce = (bytes: string, cutBytes: string) => apart?.(cutBytes) === bytes;
	if (over && unit) {
		// A pasted list joins a list of its own type over the block, the blank lines between gone.
		const before = overEmptied(read, unit, text, host);
		const after = input.source.slice(input.range.to);
		// A list that breaks out of the item the block emptied lands as law 9 says, the item gone.
		const left = readOf(host, input.source.slice(0, unit.from) + after);
		const out9 =
			input.mode === 'live' && /[*_`~[\]<]/.test(text)
				? null
				: expectedPaste(left, unit.from, text, host, { holds: 'text' });
		if (out9?.shape === 'broken out') {
			if (!out9.bytes.includes(over.source))
				out.push(`L5 a list breaking out over a block held whole gave ${q(over.source)}`);
		} else if (!over.source.startsWith(before) || !over.source.endsWith(after))
			out.push(`L5 paste over a block held whole changed bytes outside it: ${q(over.source)}`);
	} else if (over && cut) {
		const then = call(
			cut.source,
			caretRange(cut.caret.at),
			paste(text, heldBy(cut.caret)),
			input.mode
		);
		const block = oneTextBlock(read, input.range, host);
		const flat = () => call(input.source, input.range, paste(text), 'source');
		if (block) out.push(...oneWrite(host, input, block, text, { over, cut, then, flat }));
		else if (
			then &&
			!sameAfterCut(then.source, over.source, input.source, cut.source) &&
			!openEndEntered(input.source, input.range, text, over.source, then.source) &&
			!atOnce(over.source, then.source)
		)
			out.push(`L5 paste over gave ${q(over.source)}, cut then paste ${q(then.source)}`);
	}
	const pairs: [Gesture, Gesture][] = [
		['type', 'cut'],
		['compose', 'delete'],
		['command', 'backspace'],
		['break', 'delete']
	];
	for (const [gesture, like] of pairs) {
		const got = call(input.source, input.range, gesture, input.mode);
		const removal = call(input.source, input.range, like, input.mode);
		if (!got || !removal) continue;
		if (unit && gesture === 'type') {
			const kept = input.source.slice(0, unit.from) + input.source.slice(input.range.to);
			if (got.source !== kept)
				out.push(`L5 type over a block held whole left ${q(got.source)}, not ${q(kept)}`);
		} else if (
			got.source !== removal.source &&
			!(gesture === 'type' && (onSyntax(host, removal) || atOnce(got.source, removal.source)))
		) {
			out.push(`L5 ${gesture} removed to ${q(got.source)}, ${like} to ${q(removal.source)}`);
		}
	}
	return out;
}

/** A removal that leaves its caret on a block's syntax (a fence line, a heading's marker), where a
 *  typed or pasted text opens a paragraph of its own; the rows hold those bytes. */
function onSyntax(host: CheckHost, removal: Result): boolean {
	if (removal.caret.holds !== 'text') return true;
	const read = readOf(host, removal.source);
	const point = read.layout.pointAt(removal.caret.at);
	const leaf = point && read.blocks.find((b) => b.path.join() === point.path.join());
	return !leaf?.text || removal.caret.at < leaf.text.from || removal.caret.at > leaf.text.to;
}

/** L6: a drop moves what a cut takes to where a paste of its text and own entry at the drop point
 *  puts it (spec § 5.13); a copying drop is a paste of the copy there. */
export function dropLaws(call: Call, input: RangeInput, at: number): string[] {
	const out: string[] = [];
	const copy = call(input.source, input.range, 'copy', input.mode);
	if (!copy?.clipboard) return out;
	const copied = call(input.source, input.range, { drop: at, copy: true }, input.mode);
	const pasted = call(input.source, caretRange(at), paste(copy.clipboard), input.mode);
	if (copied && pasted && copied.source !== pasted.source)
		out.push(`L6 copying drop gave ${q(copied.source)}, a paste there ${q(pasted.source)}`);
	const cut = call(input.source, input.range, 'cut', input.mode);
	const moved = call(input.source, input.range, { drop: at, copy: false }, input.mode);
	if (!cut || !moved) return out;
	const mapped = mapThrough(input.source, cut.source, at);
	if (mapped === null) return out;
	const carried: Gesture = { ...paste(cut.clipboard ?? ''), own: cut.own };
	const then = call(cut.source, caretRange(mapped), carried, input.mode);
	if (then && !sameAfterCut(then.source, moved.source, input.source, cut.source))
		out.push(`L6 drop gave ${q(moved.source)}, a cut then a paste at the drop ${q(then.source)}`);
	return out;
}

/** Where byte `at` of `before` sits in `after`, outside the bytes that changed; null inside them. */
export function mapThrough(before: string, after: string, at: number): number | null {
	const head = sharedPrefixLength(before, after, Math.min(before.length, after.length));
	const tail = sharedSuffixLength(before, after, Math.min(before.length, after.length) - head);
	if (at <= head) return at;
	if (at >= before.length - tail) return at - before.length + after.length;
	return null;
}

/** L8: the caret the package hands back names a place in the new source. */
export function caretLaw(host: CheckHost, result: Result, what: string): string[] {
	const { at, holds } = result.caret;
	if (at < 0 || at > result.source.length) return [`L8 ${what} caret ${at} outside the source`];
	const read = readOf(host, result.source);
	if (holds === 'text' && !read.layout.pointAt(at) && result.source !== '')
		return [`L8 ${what} caret ${at} is in no block's text`];
	if (holds === 'block' && !read.blocks.some((b) => b.from === at))
		return [`L8 ${what} caret ${at} starts no block`];
	return [];
}

/** L9: a paste at a caret puts its bytes there, each later line behind the caret line's markers,
 *  its first paragraph and last block joining the text either side; a list that breaks out joins none. */
export function pasteAtCaret(call: Call, host: CheckHost, input: CaretInput): string[] {
	const read = readOf(host, input.source);
	// Live mode lands text that brings format runs of its own so the runs close around it.
	if (input.mode === 'live' && /[*_`~[\]<]/.test(input.text)) return [];
	const got = call(input.source, caretRange(input.at), paste(input.text, input.held), input.mode);
	if (!got) return [];
	const text = blankTail(read, input.at, input.text, host);
	if (text !== input.text) return pasteAtCaret(call, host, { ...input, text });
	// A pasted line that could close a fenced container around the caret stays inside it, whatever
	// else the law holds: the container still ends past everything that followed the caret.
	const shut = closedEarly(read, input.at, input.text, got.source, host);
	if (shut) return [`L9 a pasted line closed the ${shut} around it: ${q(got.source)}`];
	// A last line ending pasted in a list item's text, or ending a list the paste joins, is Enter
	// (`paste-ending-enter.test.ts`): it leaves the bytes before it, and the law holds the rest.
	const ended = /\r?\n$/.exec(input.text);
	const rest = ended && input.text.slice(0, ended.index);
	// An ending on the empty line the one before it opened adds nothing: the law holds one fewer.
	if (rest !== null && /\n$/.test(rest) && input.held.holds === 'text') {
		const fewer = call(input.source, caretRange(input.at), paste(rest, input.held), input.mode);
		if (fewer?.source === got.source && onBlankLine(got.source, fewer.caret.at))
			return pasteAtCaret(call, host, { ...input, text: rest });
	}
	const bare =
		rest !== null &&
		input.held.holds === 'text' &&
		(inItemText(read, input.at, host) || endsInListBeside(read, input.at, rest, host))
			? call(input.source, caretRange(input.at), paste(rest, input.held), input.mode)
			: null;
	const enters = (read: Read, at: number) => inItemText(read, at, host) || endsItem(read, at, host);
	// A list that breaks out of the caret's item ends on blocks of its own: there the ending opens an
	// item of the host's kind under them (`paste-ending-broken-out.test.ts`).
	const breaksOut =
		rest !== null &&
		bare !== null &&
		inItemText(read, input.at, host) &&
		expectedPaste(read, input.at, rest, host, input.held).shape === 'broken out';
	if (rest !== null && bare && (breaksOut || enters(readOf(host, bare.source), bare.caret.at))) {
		// Up to the caret's line: the cut there may step out of a construct no part of which stands alone.
		const line = bare.source.lastIndexOf('\n', bare.caret.at - 1) + 1;
		const kept = got.source.slice(0, line) === bare.source.slice(0, line);
		if (!kept)
			return [`L9 a last line ending in an item changed the lines before it: ${q(got.source)}`];
		return pasteAtCaret(call, host, { ...input, text: rest });
	}
	const unboxed = unboxedAt(read, input.at, input.text, host);
	if (unboxed) {
		const gesture = paste(input.text, input.held);
		const bare = call(unboxed.source, caretRange(unboxed.at), gesture, input.mode);
		if (bare && bare.source !== got.source)
			return [
				`L9 a to-do kept its box under a block of lines: ${q(got.source)}, not ${q(bare.source)}`
			];
		return pasteAtCaret(call, host, { ...input, ...unboxed });
	}
	// A last line ending where a run closes right after the text cuts the block as a split cuts it,
	// the run closed before the ending, by bytes the rows hold.
	if (input.mode === 'live' && input.text.endsWith('\n') && closesAt(read, input.at, host))
		return [];
	// In a hidden run pasted blocks cut the block as a split cuts it, by bytes the rows hold.
	const closed =
		input.mode === 'live' && inHiddenRun(read, input.at, host)
			? runsStayClosed(read, input.at, input.text, got.source, host)
			: null;
	if (closed !== null) return closed;
	const stranded = strandedInBody(read, input.at, got.source, host);
	if (stranded !== undefined)
		return [`L9 left ${q(stranded)} alone on a line its container reads as its own syntax`];
	// A one-line source shown while it's edited, given a line break, takes the shape its write rule
	// gives it (a `$$` block's fence lines of its own), by bytes the rows hold.
	if (shapedOnBreak(read, input.at, input.text, host)) return [];
	const want = expectedPaste(read, input.at, input.text, host, input.held);
	if (want.shape === 'other' || want.bytes.includes(got.source)) return [];
	// Pasted items joining a list written with another glyph take its glyph (`paste-list-glyph.test.ts`):
	// the answer is the law’s but for the glyphs.
	const glyphs = takesOtherGlyph(read, input.at, input.text, host);
	const spelled = glyphs && twoGlyphRuns(got.source) <= twoGlyphRuns(input.source);
	if (spelled && want.bytes.some((b) => oneGlyph(b) === oneGlyph(got.source))) return [];
	// A line that could close a fenced container around the caret grows its fence, as its kind writes
	// it (`paste-fence-growth.test.ts`): the answer shows the longer opening line.
	if (fenceGrew(read, input.at, input.text, got.source, host)) return [];
	// A last line ending at a container's last block writes the container's empty line under the caret's.
	const caret = got.caret.at;
	if (/\n$/.test(input.text) && want.bytes.some((b) => containerLineAdded(b, got.source, caret)))
		return [];
	// At the end of a file with no last line break, the ending opens Enter's empty paragraph.
	if (/\n$/.test(input.text) && want.bytes.some((b) => enterAtOpenEnd(read, b, got.source, caret)))
		return [];
	// A cell holds one line, which its row writes: the paste adds none and moves no other line.
	if (cellAt(read, input.at, host) && onOneLine(input.source, input.at, got.source)) return [];
	if (want.bytes.some((bytes) => oneLineInBody(read, input.at, bytes, got.source, host))) return [];
	if (asClosed(call, host, input, got)) return [];
	return [`L9 (${want.shape}) gave ${q(got.source)}, not ${q(want.bytes[0])}`];
}

/** Whether `got`, a paste in a file with no last line break, is the paste in that file ended with
 *  one, which the law holds: the same bytes, or those less that break (`syntax-tree.md` § The last line). */
function asClosed(call: Call, host: CheckHost, input: CaretInput, got: Result): boolean {
	const { source } = input;
	// Only a clipboard's last line ending may end an open file on a line break, a blank last line's.
	if (source === '' || /\n$/.test(source) || !/\n$/.test(input.text)) return false;
	const ended = { ...input, source: source + eolOf(source) };
	const closed = call(
		ended.source,
		caretRange(input.at),
		paste(input.text, input.held),
		input.mode
	);
	if (!closed || ![got.source, got.source + eolOf(source)].includes(closed.source)) return false;
	return pasteAtCaret(call, host, ended).length === 0;
}

/** Whether `line` holds container markers alone. */
const isMarkersOnly = (line: string) => /^[ \t>]*\r?$/.test(line);

/** Whether `lines`, blank lines a last line ending wrote, are a container's: they keep its markers,
 *  or stand over its closing line; a bare line at the top level is not. */
const containerLines = (lines: string[], below: string) =>
	lines.every(isMarkersOnly) &&
	(lines.some((line) => line.replace(/\r$/, '') !== '') ||
		/^[ \t>]*(?::{3,}[ \t]*\r?(?:\n|$)|<\/)/.test(below));

/** Whether `got` is `bytes`, ending the open file `read` on a written line, with Enter's empty
 *  paragraph under it and the caret on that (`syntax-tree.md` § The last line). */
function enterAtOpenEnd(read: Read, bytes: string, got: string, caret: number): boolean {
	const eol = eolOf(read.source);
	if (/\n$/.test(read.source)) return false;
	// A container's empty last line keeps its break, as Enter's does.
	const last = bytes.slice(bytes.lastIndexOf('\n') + 1);
	if (last !== '' && isMarkersOnly(last)) return got === bytes + eol;
	if (!bytes.endsWith(eol) || bytes.endsWith(eol + eol)) return false;
	return got === bytes + eol + eol && caret === bytes.length + eol.length;
}

const eolOf = (source: string) => (/\r\n/.test(source.match(/\r?\n/)?.[0] ?? '') ? '\r\n' : '\n');

/** Whether `over`, a paste over a range to the end of the open file `source`, is `then`, its cut
 *  then its paste, with the line Enter opens there: the cut alone ends the file on a line break. */
function openEndEntered(
	source: string,
	range: Range,
	text: string,
	over: string,
	then: string
): boolean {
	const eol = eolOf(source);
	if (/\n$/.test(source) || range.to !== source.length || !/\n$/.test(text)) return false;
	return over === then + eol + eol || over === then + eol;
}

/** Whether `got` is `bytes` with the empty line a last line ending opens at a container's last
 *  block put in where the caret is, and a closing line's blank line under it. */
function containerLineAdded(bytes: string, got: string, caret: number): boolean {
	const start = got.lastIndexOf('\n', caret - 1) + 1;
	let end = start;
	for (let count = 1; count <= 2 && end < got.length; count++) {
		end = got.indexOf('\n', end) + 1 || got.length;
		const lines = got.slice(start, end).split('\n').slice(0, count);
		if (got.slice(0, start) + got.slice(end) === bytes && containerLines(lines, got.slice(end)))
			return true;
	}
	return false;
}

/** Whether the line holding `at` has nothing past its markers. */
function onBlankLine(source: string, at: number): boolean {
	const line = source.slice(
		source.lastIndexOf('\n', at - 1) + 1,
		(source + '\n').indexOf('\n', at)
	);
	return /^[ \t>]*\r?$/.test(line);
}

/** Whether `text` gives a line break to the one-line source shown while edited that holds `at`. */
function shapedOnBreak(read: Read, at: number, text: string, host: CheckHost): boolean {
	const leaf = leafAt(read, at);
	if (!leaf || host.facts(leaf.type).textPosition !== 'while-source-shows') return false;
	return text.includes('\n') && !read.source.slice(leaf.from, leaf.to).trimEnd().includes('\n');
}

/** The type of a fenced container at `at`, closed by its own line, that a line of `text` could close
 *  and that ends in `got` before the bytes that followed it; a container the clipboard opens aside. */
function closedEarly(read: Read, at: number, text: string, got: string, host: CheckHost) {
	const clip = readOf(host, lf(text));
	const opens = clip.blocks.some(
		(b) => b.path.length === 1 && host.facts(b.type).lines === 'fenced'
	);
	if (opens) return undefined;
	const lines = clip.source.split('\n');
	const grown = got.length - read.source.length;
	return containersHolding(read, at).find((c) => {
		const fence = host.facts(c.type).lines === 'fenced' ? fenceOf(read, c, host) : null;
		if (!fence || fence.closer === null || !lines.some((line) => fence.mayClose(line)))
			return false;
		const now = readOf(host, got).blocks.find((b) => b.from === c.from && b.type === c.type);
		return !now || now.to < c.to + grown;
	})?.type;
}

/** Whether a line of `text` could close a fenced container holding byte `at`, and `got` wrote that
 *  container another opening line for it. */
function fenceGrew(read: Read, at: number, text: string, got: string, host: CheckHost): boolean {
	const lines = lf(text).split('\n');
	const opening = (source: string, from: number) =>
		source.slice(from, (source + '\n').indexOf('\n', from));
	return containersHolding(read, at).some((c) => {
		const fence = host.facts(c.type).lines === 'fenced' ? fenceOf(read, c, host) : null;
		const closes = !!fence && lines.some((line) => fence.mayClose(line));
		return closes && opening(read.source, c.from) !== opening(got, c.from);
	});
}

/** How many lines of `source` open an item right under an item of the same indent and type that
 *  writes another glyph: items a paste wrote into a list without taking its glyph show as one. */
function twoGlyphRuns(source: string): number {
	const marker = (line: string) => /^([ \t>]*)(?:([-+*])|\d+([.)]))(?=[ \t\r]|$)/.exec(line);
	const lines = source.split('\n');
	return lines.filter((line, i) => {
		const [above, here] = [marker(lines[i - 1] ?? ''), marker(line)];
		if (!above || !here || above[1] !== here[1] || !above[2] !== !here[2]) return false;
		return (above[2] ?? above[3]) !== (here[2] ?? here[3]);
	}).length;
}

/** `source` with every list marker that starts a line spelled with one bullet and one delimiter. */
const oneGlyph = (source: string) =>
	source.replace(/^([ \t>]*)(?:[-+*]|(\d+)[.)])(?=[ \t\r]|$)/gm, (_, lead: string, n?: string) =>
		n ? `${lead}${n}.` : `${lead}-`
	);

/** Whether byte `at` stands in the text of a list item's own block, text that isn't literal. */
function inItemText(read: Read, at: number, host: CheckHost): boolean {
	const leaf = leafAt(read, at);
	if (leaf && host.facts(leaf.type).body === 'literal') return false;
	const above = leaf?.path.slice(0, -2).join();
	const list = leaf && read.blocks.find((b) => b.path.length > 0 && b.path.join() === above);
	return !!list && host.facts(list.type).lines === 'items';
}

/** Whether byte `at` ends a list item's content, past a block that holds none of its text. */
function endsItem(read: Read, at: number, host: CheckHost): boolean {
	const item = containersHolding(read, at).findLast((c) => {
		const list = read.blocks.find((b) => b.path.join() === c.path.slice(0, -1).join());
		return c.path.length > 1 && !!list && host.facts(list.type).lines === 'items';
	});
	const ending = item && /\r?\n$/.exec(read.source.slice(item.from, item.to));
	return !!item && item.to - (ending?.[0].length ?? 0) === at;
}

/** The half of the caret's line that `got` leaves alone on a line of its own, where a container
 *  around the caret has a write rule that changes it there (a closing tag alone). */
function strandedInBody(read: Read, at: number, got: string, host: CheckHost) {
	const { source } = read;
	const text = leafAt(read, at)?.text;
	if (!text) return undefined;
	const start = Math.max(source.lastIndexOf('\n', at - 1) + 1, text.from);
	const end = Math.min((source + '\n').indexOf('\n', at), text.to);
	const kinds = containersHolding(read, at).map((container) => container.type);
	const lines = (bytes: string, line: string) =>
		lf(bytes)
			.split('\n')
			.filter((l) => l === line);
	return [source.slice(start, at), source.slice(at, end).replace(/\r$/, '')].find(
		(half) =>
			kinds.some((kind) => host.inBody(kind, half) !== half) &&
			lines(got, half).length > lines(source, half).length
	);
}

/** Whether `got` is `want` with one line as a container around the caret takes it into its body:
 *  a half the cut leaves alone on a line that would read as that container's own closing tag. */
function oneLineInBody(read: Read, at: number, want: string, got: string, host: CheckHost) {
	const differs = sharedPrefixLength(want, got, Math.min(want.length, got.length));
	const start = want.lastIndexOf('\n', differs - 1) + 1;
	const end = (want + '\n').indexOf('\n', differs);
	const taken = (kind: string) =>
		want.slice(0, start) + host.inBody(kind, want.slice(start, end)) + want.slice(end);
	return containersHolding(read, at).some((container) => taken(container.type) === got);
}

/** Whether `got` is `source` with only the line holding `at` rewritten, still one line. */
function onOneLine(source: string, at: number, got: string): boolean {
	const start = source.lastIndexOf('\n', at - 1) + 1;
	const rest = source.slice((source + '\n').indexOf('\n', at));
	const kept = got.startsWith(source.slice(0, start)) && got.endsWith(rest);
	return kept && !got.slice(start, got.length - rest.length).includes('\n');
}

/** Whether the caret sits in a format run of a prose block, or between two delimiter characters,
 *  a place no live caret takes: text written there re-reads the runs around it. */
function inHiddenRun(read: Read, at: number, host: CheckHost): boolean {
	const leaf = leafAt(read, at);
	if (!leaf || !['text', 'text-keeping-type'].includes(host.facts(leaf.type).joins)) return false;
	return (
		betweenDelimiters(read.source, at) ||
		liveCutAt(read, at, host) !== null ||
		inConstructAt(read, at, host)
	);
}

/** Whether a format run of the caret's prose block ends its text at `at`, its closer after it. */
function closesAt(read: Read, at: number, host: CheckHost): boolean {
	const leaf = leafAt(read, at);
	if (!leaf?.text) return false;
	const text = read.source.slice(leaf.text.from, leaf.text.to);
	const offset = at - leaf.text.from;
	return host.heldAt(text, offset) && host.runsAt(text, offset).length === 0;
}

/** Whether the caret's block holds three of one delimiter in a row: a closer or an opener beside
 *  a run of its own character re-reads both, so no cut of a run there is sound. */
function crowded(read: Read, at: number): boolean {
	const leaf = leafAt(read, at);
	return !!leaf?.text && /([*_~])\1\1/.test(read.source.slice(leaf.text.from, leaf.text.to));
}

const betweenDelimiters = (source: string, at: number) =>
	/^[*_~`[\]()]{2}$/.test(source.slice(at - 1, at + 1));

/** L9 in live mode at a caret in a format run: pasted blocks leave open no run that their text
 *  typed there on one line leaves closed. Null for one paragraph, which the bytes judge. */
function runsStayClosed(
	read: Read,
	at: number,
	text: string,
	got: string,
	host: CheckHost
): string[] | null {
	if (liveCutAt(read, at, host) === 'literal' || betweenDelimiters(read.source, at)) return [];
	if (crowded(read, at)) return [];
	const tops = readOf(host, lf(text)).blocks.filter(
		(b) => b.path.length === 1 && text.slice(b.from, b.to).trim() !== ''
	);
	if (tops.length < 2 && tops[0]?.type === 'paragraph') return null;
	// A second half that joins a pasted block's last line reopens in a marker that opens there;
	// where none does, the literal cut stands.
	const last = tops.at(-1);
	const behind = last && last.type !== 'paragraph' && host.facts(last.type).joins !== 'never';
	if (behind && !text.endsWith('\n') && reopensNowhere(read, at, text, host)) return [];
	const letters = text.replace(/\s*\n\s*/g, '');
	if (letters === '') return [];
	const typed = read.source.slice(0, at) + letters + read.source.slice(at);
	const [was, now] = [shownDelimiters(host, typed), shownDelimiters(host, got)];
	return was === now ? [] : [`L9 live shows ${now} format delimiters, not ${was}: ${q(got)}`];
}

/** L9 at the caret a cut left, for the cut's own clipboard and for `text`. */
export function pasteAtCutCaret(
	call: Call,
	host: CheckHost,
	input: RangeInput,
	text?: string
): string[] {
	const cut = call(input.source, input.range, 'cut', input.mode);
	if (!cut) return [];
	const at = { source: cut.source, mode: input.mode, at: cut.caret.at, held: heldBy(cut.caret) };
	const texts = text === undefined ? [cut.clipboard ?? ''] : [cut.clipboard ?? '', text];
	return texts.flatMap((t) => pasteAtCaret(call, host, { ...at, text: t }));
}

/** L10: a range the cut takes nothing from holds no text the mode shows and copies none; in source
 *  mode, a copy carries the markers of the containers it enters or leaves, none of the shared one. */
export function copyMarkers(call: Call, host: CheckHost, input: RangeInput): string[] {
	const copy = call(input.source, input.range, 'copy', input.mode);
	if (!copy || copy.clipboard === undefined) return [];
	const read = readOf(host, input.source);
	// A range from or into a title row copies by the title row's own rule, which the rows hold.
	if (inTitleRow(read, input.range.from, host) || inTitleRow(read, input.range.to, host)) return [];
	const { from, to } = input.range;
	const cut = call(input.source, input.range, 'cut', input.mode);
	if (cut?.source === input.source) {
		if (holdsShownText(read, from, to, host, input.mode))
			return [`L10 the cut took nothing from a range holding text`];
		return copy.clipboard.trim() === ''
			? []
			: [`L10 copy wrote ${q(copy.clipboard)}, the cut nothing`];
	}
	if (input.mode !== 'source') return [];
	const want = expectedCopy(read, from, to, host);
	return copy.clipboard === want ? [] : [`L10 copy wrote ${q(copy.clipboard)}, not ${q(want)}`];
}

/** L11: Paste as plain text puts its text in at the caret as text the block shows. */
export function plainPaste(call: Call, host: CheckHost, input: CaretInput): string[] {
	const got = call(
		input.source,
		caretRange(input.at),
		{ paste: input.text, plain: true, ...input.held },
		input.mode
	);
	if (!got) return [];
	const read = readOf(host, input.source);
	if (plainPasteHolds(read, input.at, input.text, got.source, host, input.mode)) return [];
	const escaped = host.escaped(lf(input.text));
	// A last line ending where a run closes right after the text: the run closes before the break,
	// so the answer shows the delimiters its text typed there on one line shows, none left bare.
	if (input.mode === 'live' && input.text.endsWith('\n') && closesAt(read, input.at, host)) {
		const letters = escaped.replace(/\s*\n\s*/g, '');
		const typed = read.source.slice(0, input.at) + letters + read.source.slice(input.at);
		const [was, now] = [shownDelimiters(host, typed), shownDelimiters(host, got.source)];
		return was === now
			? []
			: [`L11 live shows ${now} format delimiters, not ${was}: ${q(got.source)}`];
	}
	// A blank line in the text cuts the block as a pasted block boundary does: law 9 holds the
	// escaped text's bytes, and in a hidden run the rows do.
	const closed =
		input.mode === 'live' && inHiddenRun(read, input.at, host)
			? runsStayClosed(read, input.at, escaped, got.source, host)
			: null;
	if (closed !== null) return closed;
	const lands = (text: string) =>
		expectedPaste(read, input.at, text, host, input.held).bytes.includes(got.source);
	return lands(escaped) || lands(escaped.replace(/\n$/, ''))
		? []
		: [`L11 plain paste of ${q(input.text)} gave ${q(got.source)}`];
}

export { endingOf };
