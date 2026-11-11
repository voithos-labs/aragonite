// The laws as checks over the package's answers alone: each takes the package, the host and one
// input, and returns a line per broken law. A check that can't decide (the package declined, the
// shape is one the rows hold) says nothing.

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
import {
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
	reopensNowhere,
	lf,
	liveSplitsRun,
	opensWithoutClosing,
	mixedEndings,
	plainPasteHolds,
	readOf,
	sameBlocks,
	sameDocument,
	shownDelimiters,
	copiesLinesBeforeRange,
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
	paste: text,
	plain: false,
	...held
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
	if (input.mode === 'live' && liveSplitsRun(read, input.range.from, input.range.to, host))
		return [];
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
	const pinned = want.shape !== 'other' && !(want.shape === 'apart' && whole);
	if (pinned && held.holds === 'text' && !want.bytes.includes(input.source)) return [];
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

/** A removal keeps the bytes before the range and the end line's text after it (spec § 5.2);
 *  live mode, whose rules rewrite format runs at the edges, is held to the bytes before, runs aside. */
export function keepsOutside(call: Call, host: CheckHost, input: RangeInput): string[] {
	const { source } = input;
	const { from, to } = input.range;
	const read = readOf(host, source);
	if (liveWholeText(read, input.range, input.mode)) return [];
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
		const kept = runless(got.source).startsWith(runless(source.slice(0, from)));
		if (!kept || (tail !== '' && got.source.indexOf(tail, from) < 0))
			out.push(`L4 ${key} changed bytes outside the range: ${q(got.source)}`);
	}
	return out;
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

/** `then`, a paste after the cut, is `over`, the one gesture's answer, save in line endings where
 *  the cut took the source's first: `over` writes that one, `then` the one it finds, LF for none. */
function sameAfterCut(then: string, over: string, source: string, cut: string): boolean {
	const ending = endingOf(source);
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
	const kept = got.startsWith(before) && got.endsWith(after);
	// One write closes a format run a live range cuts another way than a cut then a paste: there
	// the bytes outside the range stay and the block keeps its kind.
	const cutsRun = input.mode === 'live' && liveSplitsRun(read, from, to, host);
	// A list that breaks out splits the caret's list around the range as law 9 says: an item with no
	// text left on either side gives way, its marker with it.
	const out = cutsRun ? null : expectedPaste(read, from, text, host, TEXT, to);
	if (out?.shape === 'broken out')
		return out.bytes.includes(over.source)
			? []
			: [`L5 a list breaking out over a range gave ${q(over.source)}, not ${q(out.bytes[0])}`];
	// Paragraphs pasted into prose join the text either side, whatever a cut then a paste would give:
	// the bytes outside the range stay, and the lines between are the clipboard's, none added.
	if (joinsProse(read, block, text, host) && !cutsRun) {
		if (!kept)
			return [`L5 paste over text in one block changed bytes outside it: ${q(over.source)}`];
		const lines = (bytes: string) => bytes.split('\n').length;
		if (lines(got.slice(before.length, got.length - after.length)) !== lines(text))
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
	if (!kept) return [`L5 paste over text in one block changed bytes outside it: ${q(over.source)}`];
	const kindAt = (bytes: string | undefined) =>
		bytes === undefined
			? undefined
			: readOf(host, bytes).blocks.find((b) => b.from === block.from && !b.lines)?.type;
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
	if (over && unit) {
		const before = input.source.slice(0, unit.from);
		const after = input.source.slice(input.range.to);
		// A list that breaks out of the item the block emptied lands as law 9 says, the item gone.
		const left = readOf(host, before + after);
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
		else if (then && !sameAfterCut(then.source, over.source, input.source, cut.source))
			out.push(`L5 paste over gave ${q(over.source)}, cut then paste ${q(then.source)}`);
	}
	const pairs: [Gesture, Gesture][] = [
		['type', 'cut'],
		['compose', 'delete'],
		['command', 'backspace']
	];
	for (const [gesture, like] of pairs) {
		const got = call(input.source, input.range, gesture, input.mode);
		const removal = call(input.source, input.range, like, input.mode);
		if (!got || !removal) continue;
		if (unit && gesture === 'type') {
			const kept = input.source.slice(0, unit.from) + input.source.slice(input.range.to);
			if (got.source !== kept)
				out.push(`L5 type over a block held whole left ${q(got.source)}, not ${q(kept)}`);
		} else if (got.source !== removal.source && !(gesture === 'type' && onSyntax(host, removal))) {
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
	// In a hidden run pasted blocks cut the block as a split cuts it, by bytes the rows hold.
	const closed =
		input.mode === 'live' && inHiddenRun(read, input.at, host)
			? runsStayClosed(read, input.at, input.text, got.source, host)
			: null;
	if (closed !== null) return closed;
	const want = expectedPaste(read, input.at, input.text, host, input.held);
	if (want.shape === 'other' || want.bytes.includes(got.source)) return [];
	// A cell holds one line, which its row writes: the paste adds none and moves no other line.
	if (cellAt(read, input.at, host) && onOneLine(input.source, input.at, got.source)) return [];
	return [`L9 (${want.shape}) gave ${q(got.source)}, not ${q(want.bytes[0])}`];
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
	// A blank line in the text cuts the block as a pasted block boundary does: law 9 holds the
	// escaped text's bytes, and in a hidden run the rows do.
	const escaped = host.escaped(lf(input.text));
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
