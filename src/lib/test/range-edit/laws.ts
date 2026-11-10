// The laws as checks over the package's answers alone: each takes the package, the host and one
// input, and returns a line per broken law. A check that can't decide (the package declined, the
// shape is one the rows hold) says nothing.

import { sharedPrefixLength, sharedSuffixLength } from '#lib/core/written-span.js';
import type { Gesture, Range, RangeEditResult as Result } from '#lib/range-edit/edit-range.js';
import type { Mode } from '#lib/range-edit/host.js';
import type { CheckHost } from './test-host';
import {
	endingOf,
	expectedCopy,
	expectedPaste,
	holdsShownText,
	inTitleRow,
	leavesLiteralBlock,
	lf,
	liveSplitsRun,
	opensWithoutClosing,
	mixedEndings,
	plainPasteHolds,
	readOf,
	sameBlocks,
	sameDocument,
	copiesLinesBeforeRange,
	type Read
} from './expected';

export interface RangeInput {
	source: string;
	mode: Mode;
	range: Range;
}

export interface CaretInput {
	source: string;
	mode: Mode;
	at: number;
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
const paste = (text: string): Gesture => ({ paste: text, plain: false });

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
	const withOwn = (r: Result): Gesture => ({
		paste: lf(r.clipboard ?? ''),
		plain: false,
		own: r.own
	});
	const cut = call(source, range, 'cut', mode);
	if (cut?.clipboard !== undefined) {
		const back = call(cut.source, caretRange(cut.caret.at), withOwn(cut), mode);
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
	const cut = call(input.source, input.range, 'cut', input.mode);
	if (!cut || cut.clipboard === undefined) return [];
	// The editor hands a paste its text with LF line endings.
	const text = lf(cut.clipboard);
	// Where law 9 pins the paste back to other bytes, law 9 wins; the own entry gives them back.
	const want = expectedPaste(readOf(host, cut.source), cut.caret.at, text, host);
	if (want.shape !== 'other' && !want.bytes.includes(input.source)) return [];
	const back = call(cut.source, caretRange(cut.caret.at), paste(text), input.mode);
	if (!back) return [];
	const [source, got] = mixedEndings(input.source)
		? [lf(input.source), lf(back.source)]
		: [input.source, back.source];
	if (got === source) return [];
	const { from, to } = input.range;
	// Plain text can't carry how each covered line spelled its markers: the same blocks will do.
	if (sameDocument(host, source, got, from, to)) return [];
	// A block taken whole takes a blank line beside it, which plain text can't give back (spec § 4).
	const taken = input.source.length - cut.source.length - (to - from);
	if (taken > endingOf(input.source).length && sameBlocks(host, source, got)) return [];
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

/** L5: a paste over a range is the cut, then the paste; a typed character's, a composition's and a
 *  command's removal is the cut's, the Delete's and the Backspace's (the spec's section 4). */
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
		if (!over.source.startsWith(before) || !over.source.endsWith(after))
			out.push(`L5 paste over a block held whole changed bytes outside it: ${q(over.source)}`);
	} else if (over && cut) {
		const then = call(cut.source, caretRange(cut.caret.at), paste(text), input.mode);
		if (then && then.source !== over.source)
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
	const carried: Gesture = { paste: cut.clipboard ?? '', plain: false, own: cut.own };
	const then = call(cut.source, caretRange(mapped), carried, input.mode);
	if (then && then.source !== moved.source)
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
	const want = expectedPaste(read, input.at, input.text, host);
	if (want.shape === 'other') return [];
	const got = call(input.source, caretRange(input.at), paste(input.text), input.mode);
	if (!got || want.bytes.includes(got.source)) return [];
	return [`L9 (${want.shape}) gave ${q(got.source)}, not ${q(want.bytes[0])}`];
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
	const at = { source: cut.source, mode: input.mode, at: cut.caret.at };
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
		{ paste: input.text, plain: true },
		input.mode
	);
	if (!got) return [];
	const read = readOf(host, input.source);
	return plainPasteHolds(read, input.at, input.text, got.source, host, input.mode)
		? []
		: [`L11 plain paste of ${q(input.text)} gave ${q(got.source)}`];
}

export { endingOf };
